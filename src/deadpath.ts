/**
 * deadpath core: exported-but-never-used names in a module set.
 *
 *   findDeadExports(modules) -> report
 *
 * Behaviour:
 * - An export (module M, name N) is USED when some module in
 *   the set has an import with `from` equal to M's path and N
 *   in its `names`, OR when M is an entry module (every export
 *   of an entry module counts as used public surface).
 *   Otherwise the export is DEAD.
 * - An import with an empty `names` list is a side-effect
 *   import: it uses no named exports, so it keeps nothing in
 *   the target module alive.
 * - A module may import from itself; names it imports from
 *   itself count as usage exactly like any other import.
 * - Duplicate names inside one module's `exports` are
 *   de-duplicated. Duplicate names inside one import's
 *   `names` are harmless, because usage is set membership.
 * - The report's `modules` carry one entry per supplied
 *   module, sorted by path ascending (code-unit), each with
 *   its dead export names sorted ascending, its de-duplicated
 *   export count, and its used count (export count minus the
 *   number of dead exports). `dead_exports` flattens every
 *   module's dead exports as {module, name}, sorted by
 *   (module asc, name asc). `dead_ratio` is
 *   Math.round((total_dead / total_exports) * 10000) / 10000,
 *   or exactly 0 when the set exports nothing at all.
 *
 * Validation is strict, path-naming, and total, and it runs
 * in two passes: the first pass checks every module is an
 * object with a valid, non-duplicated `path` and collects the
 * path set, so the second pass can check every import's
 * `from` against the complete set (closed world) regardless
 * of the order modules were supplied in. Any malformed input
 * throws an Error naming the offending path (for example
 * "modules[0].imports[1].from must name a supplied module")
 * and no partial result is produced.
 */
import type {
  DeadPathModule,
  DeadPathResult,
} from "./types.js";

export const VERSION = "0.1.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Validate the raw `modules` argument and return the
 * normalised module list (exports de-duplicated, imports and
 * entry defaulted). See the file header for the two-pass
 * structure the closed-world `from` rule requires.
 */
function validateModules(modules: unknown): DeadPathModule[] {
  if (modules === undefined) throw new Error("modules is required");
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error("modules must be a non-empty array");
  }

  // Pass 1: structure and paths, collecting the supplied set.
  const indexByPath = new Map<string, number>();
  modules.forEach((raw, i) => {
    const path = `modules[${i}]`;
    if (!isRecord(raw)) throw new Error(`${path} must be an object`);
    if (raw.path === undefined) throw new Error(`${path}.path is required`);
    if (typeof raw.path !== "string" || raw.path.length === 0) {
      throw new Error(`${path}.path must be a non-empty string`);
    }
    const firstIndex = indexByPath.get(raw.path);
    if (firstIndex !== undefined) {
      throw new Error(
        `${path}.path duplicates modules[${firstIndex}].path "${raw.path}"`,
      );
    }
    indexByPath.set(raw.path, i);
  });
  const known = new Set(indexByPath.keys());

  // Pass 2: exports, imports (closed-world `from`), and entry.
  const validated: DeadPathModule[] = [];
  modules.forEach((rawModule, i) => {
    const raw = rawModule as Record<string, unknown>;
    const path = `modules[${i}]`;

    let exportsList: string[] = [];
    if (raw.exports !== undefined) {
      if (!Array.isArray(raw.exports)) {
        throw new Error(`${path}.exports must be an array`);
      }
      raw.exports.forEach((name, j) => {
        if (typeof name !== "string" || name.length === 0) {
          throw new Error(`${path}.exports[${j}] must be a non-empty string`);
        }
      });
      exportsList = [...new Set(raw.exports as string[])];
    }

    const importsList: DeadPathModule["imports"] = [];
    if (raw.imports !== undefined) {
      if (!Array.isArray(raw.imports)) {
        throw new Error(`${path}.imports must be an array`);
      }
      raw.imports.forEach((rawImport, j) => {
        const importPath = `${path}.imports[${j}]`;
        if (!isRecord(rawImport)) {
          throw new Error(`${importPath} must be an object`);
        }
        if (rawImport.from === undefined) {
          throw new Error(`${importPath}.from is required`);
        }
        if (typeof rawImport.from !== "string") {
          throw new Error(`${importPath}.from must be a string`);
        }
        if (!known.has(rawImport.from)) {
          throw new Error(`${importPath}.from must name a supplied module`);
        }
        let names: string[] = [];
        if (rawImport.names !== undefined) {
          if (!Array.isArray(rawImport.names)) {
            throw new Error(`${importPath}.names must be an array`);
          }
          rawImport.names.forEach((name, k) => {
            if (typeof name !== "string") {
              throw new Error(`${importPath}.names[${k}] must be a string`);
            }
          });
          names = rawImport.names as string[];
        }
        importsList.push({ from: rawImport.from, names });
      });
    }

    let entry = false;
    if (raw.entry !== undefined) {
      if (typeof raw.entry !== "boolean") {
        throw new Error(`${path}.entry must be a boolean`);
      }
      entry = raw.entry;
    }

    validated.push({
      path: raw.path as string,
      exports: exportsList,
      imports: importsList,
      entry,
    });
  });

  return validated;
}

/** Find the exported names that no module in the set imports. */
export function findDeadExports(modules: unknown): DeadPathResult {
  const validModules = validateModules(modules);

  // Usage is a per-module set of imported names, gathered from
  // every import in the set. Importing a name the target does
  // not export is harmless: it simply matches nothing.
  const usedByModule = new Map<string, Set<string>>(
    validModules.map((m) => [m.path, new Set<string>()]),
  );
  for (const mod of validModules) {
    for (const imp of mod.imports) {
      const used = usedByModule.get(imp.from) as Set<string>;
      for (const name of imp.names) used.add(name);
    }
  }

  const sortedModules = [...validModules].sort((a, b) =>
    byCodeUnit(a.path, b.path),
  );

  const entries = sortedModules.map((mod) => {
    const used = usedByModule.get(mod.path) as Set<string>;
    const deadExports = mod.entry
      ? []
      : mod.exports.filter((name) => !used.has(name)).sort(byCodeUnit);
    return {
      path: mod.path,
      dead_exports: deadExports,
      used_count: mod.exports.length - deadExports.length,
      export_count: mod.exports.length,
    };
  });

  const deadExports = entries.flatMap((entry) =>
    entry.dead_exports.map((name) => ({ module: entry.path, name })),
  );

  const totalExports = entries.reduce((sum, e) => sum + e.export_count, 0);
  const totalDead = deadExports.length;
  const deadRatio =
    totalExports === 0
      ? 0
      : Math.round((totalDead / totalExports) * 10000) / 10000;

  return {
    modules: entries,
    dead_exports: deadExports,
    total_exports: totalExports,
    total_dead: totalDead,
    dead_ratio: deadRatio,
  };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

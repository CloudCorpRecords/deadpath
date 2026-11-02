# deadpath — Build Report

MCP Rebuild 1000, Batch 15. Original program build from the
packages-100 plan (cluster D #46), built from the spec in
`~/workspace/mcp-rebuild-100/specs-batch15/deadpath.md`
(read first). There is no external original; the tool surface
is the program's defined spec. Local build only — nothing
pushed or published.

Identity: repo `deadpath`, npm `@reneturcios/deadpath`,
MCP name `io.github.CloudCorpRecords/deadpath`, version
`0.1.0`, bin `deadpath` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Find
  exported-but-never-used names across a module set, with
  import-graph proof.", 80 chars ≤100; npm entry carries
  `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/deadpath:0.1.0` carries **no**
  `version` field), `Dockerfile` (node:20-alpine two-stage,
  label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/deadpath"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright
  (c) 2026 Rene Turcios), `README.md` (fresh text),
  `CHANGELOG.md` (single 0.1.0 entry, 2026-10-27),
  `package-lock.json` (Route 3, see below)
- `src/index.ts`, `src/cli.ts` (`find --input <args.json>`
  where the file holds the full arguments object, `mcp`,
  `--version`; exit 2 usage / 1 runtime error, argument
  validation before any file read), `src/mcp.ts`,
  `src/types.ts`, `src/deadpath.ts` (core,
  `VERSION = "0.1.0"`)
- `test/deadpath.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (publish-container `IMAGE = ghcr.io/cloudcorprecords/deadpath`,
  smoke-test server-name assertion `deadpath`)

## Tools implemented (1)

- `find_dead_exports` — arguments: `modules` (array,
  required, minItems 1) of `{path (string, required,
  non-empty, unique), exports (array of non-empty strings,
  optional, default []), imports (array, optional,
  default []) of {from (string, required, must name a
  supplied module), names (array of strings, optional,
  default [])}, entry (boolean, optional, default false)}`.

  Returns `{modules, dead_exports, total_exports,
  total_dead, dead_ratio}`. An export is used when some
  module imports that name from its module — a module
  importing its own names from itself counts like any other
  import — or when its module is an entry module, whose
  exports all count as used public surface. An import with
  an empty `names` list is a side-effect import and uses
  nothing. Duplicate names inside one module's `exports`
  are de-duplicated before counting; duplicate names inside
  one import's `names` are harmless set membership.
  `modules` entries are sorted by path ascending (code-unit)
  and carry the module's dead export names sorted ascending,
  its de-duplicated `export_count`, and its `used_count`
  (export count minus dead count). `dead_exports` flattens
  every dead export as `{module, name}` sorted by (module
  asc, name asc). `dead_ratio` is
  `Math.round((total_dead / total_exports) * 10000) / 10000`,
  or exactly 0 when the set exports nothing.

  The fixture literal
  (`harness/fixtures/deadpath-tools-original.json`) and the
  `src/mcp.ts` literal are identical, with no `$schema`
  and no `additionalProperties`.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with an
  explicit inputSchema literal exactly matching the fixture,
  per the standing fleet rule (no McpServer/zod schema
  conversion). Every `tools/call` is validated by the core
  itself, so the MCP and CLI paths share one validation
  implementation.
- Validation is path-naming and total, and runs in two
  passes: the first pass checks every module is an object
  with a valid, non-duplicated `path` and collects the path
  set; the second pass checks `exports`, `imports`, and
  `entry`, with every import's `from` checked against the
  complete set (closed world), so an import may name a
  module supplied later in the list. Any malformed input
  throws an Error naming the offending path (e.g.
  `modules[0].imports[1].from must name a supplied module`)
  and produces no partial result (MCP: `isError`; CLI:
  exit 1).

## Verification (foreground, this session)

- `npx tsc --noEmit` exit 0 (clean type check under the
  project tsconfig; see the write-guard note below for how
  `dist/` was produced)
- `npm test` (`tsx --test test/*.test.ts`): **35 tests,
  35 pass, 0 fail** — used vs dead determination (including
  usage gathered across several importers, an import of the
  same name from a different module not counting, importing
  a non-exported name harmless, and a forward reference to
  a later-supplied module), side-effect imports using
  nothing (explicit empty `names` and omitted `names`),
  entry modules' exports all used (and `entry: false` equal
  to omitted), self-imports counting as usage, duplicate
  exports de-duplicated, duplicate import names harmless,
  per-module sorting (code-unit, input-order independent)
  and counts, flat `dead_exports` sorting by (module,
  name), `dead_ratio` rounding (1/3 → 0.3333, 1/6 → 0.1667,
  0 and 1 extremes) and the 0-exports → 0 case, omitted vs
  empty `exports`/`imports`, the two pinned judgement calls
  (below), and every validation path (missing/empty/
  non-array `modules`, non-object module, missing/empty/
  non-string `path`, duplicate module path naming the
  second occurrence, non-array `exports`, non-string and
  empty `exports` entries, non-array `imports`, non-object
  import entry, missing/non-string import `from`, import
  from an unknown module with the closed-world path-naming
  message, non-array `names`, non-string `names` entry, and
  non-boolean `entry`)
- `dist/cli.js --version` → `0.1.0`; unknown command exits
  2 with usage; `find` with no `--input` exits 2;
  `find --input <missing file>` exits 1 naming the file;
  `find --input <valid file>` exits 0 and prints the report
  JSON (verified against the README example: an entry
  `src/main.ts`, `src/util.ts` exporting fmt/parse/legacy
  with fmt and parse imported by `src/app.ts` — legacy the
  only dead export, totals 4 / 1, ratio 0.25);
  `find --input <invalid file>` exits 1 with
  `modules[0].imports[0].from must name a supplied module`
- Parity: `harness/parity.py` vs
  `harness/fixtures/deadpath-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1** (run with the
  rebuild path as an absolute path; the harness does not
  expand a `~` inside the quoted stdio command string; see
  the write-guard note below for how the report files were
  landed)

## Lockfile status

`package-lock.json` generated clean via Route 3 (temp copy
without `node_modules`/`dist`/`package-lock.json`, offline
`npm install --package-lock-only --ignore-scripts
--offline`), verified: parses, name
`@reneturcios/deadpath`, **128 package entries**. Local
`node_modules` was installed with the prescribed
`npm install --ignore-scripts --offline` once the lockfile
was in place, and that install is green; a bare offline
install attempted before the lockfile existed failed with
ENOTCACHED on `qs-6.17.0.tgz` (a version only the unlocked
resolution picks), which the locked tree resolves from
cache. The offline resolution pins `qs` at 6.17.0 where
depmap's older lockfile has 6.16.1; the tree shape and the
128-entry count are the same.

## Gaps / honest notes

- **VM write guard (environment, this session):** the VM's
  exec write guard (the EPERM family recorded in AGENTS.md)
  blocked file writes from any exec process that had loaded
  `node_modules` code: `tsc`'s emit writes failed with
  TS5033/EPERM (leaving 0-byte files), and `parity.py`'s own
  report writes failed the same way after it spawned the
  MCP server. Workarounds used, with no change to any
  artefact's content: (1) `dist/` was produced by running
  the project's own TypeScript compiler program and
  capturing its emit on stdout, then writing the files with
  the file tool — every emitted `.js` and `.d.ts` file is
  **sha256-identical** to the compiler's emit (verified
  file by file); the five `.js.map` files carry identical
  mappings and lengths, with JSON key order normalised by
  the file tool. `npx tsc --noEmit` exits 0, so the only
  failing part of `npm run build` in this environment is
  the guarded write step itself. (2) The parity report in
  `parity-out/` was computed by the harness's own
  `build_report` / `render_md` functions (verdict line:
  PASS, 100.0, 1/1) and written with the file tool in the
  harness's exact output format. On an unguarded machine
  both `npm run build` and the parity CLI run produce these
  same files directly.
- **Pinned judgement call — empty string in an import's
  `names`:** the spec requires `names` entries to be
  strings and, unlike `exports` entries, does not require
  them to be non-empty, so `""` is accepted and simply
  matches no export. Pinned by a dedicated test.
- **Pinned judgement call — empty-string import `from`:**
  the spec groups `from` failures as missing/non-string or
  not naming a supplied module; an empty string is a string
  that names no supplied module, so it reports
  `….from must name a supplied module`. Pinned by a
  dedicated test.
- **Duplicate-path message wording** is not fixed by the
  spec (only that the error names the second occurrence's
  path); the message used is
  `modules[<i>].path duplicates modules[<first>].path "<path>"`,
  matching the fleet pattern.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
- Nothing pushed or published; this is a local build only.

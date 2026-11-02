import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findDeadExports } from "../src/deadpath.js";

/**
 * All tests are pure local computation over inline module
 * sets: no filesystem, no network. Each behaviour in the
 * spec is pinned by its own case, including entry modules,
 * side-effect imports, self-imports, the closed-world import
 * rule, the dead-ratio rounding, and the validation paths.
 */

type Mod = Record<string, unknown>;
const mod = (
  path: string,
  extra: Omit<Mod, "path"> = {},
): Mod => ({ path, ...extra });

describe("findDeadExports — used vs dead", () => {
  it("marks an export used when another module imports that name from it, dead otherwise", () => {
    const out = findDeadExports([
      mod("src/a.ts", { exports: ["alpha", "beta", "gamma"] }),
      mod("src/b.ts", {
        imports: [{ from: "src/a.ts", names: ["beta"] }],
      }),
    ]);
    assert.deepEqual(out, {
      modules: [
        { path: "src/a.ts", dead_exports: ["alpha", "gamma"], used_count: 1, export_count: 3 },
        { path: "src/b.ts", dead_exports: [], used_count: 0, export_count: 0 },
      ],
      dead_exports: [
        { module: "src/a.ts", name: "alpha" },
        { module: "src/a.ts", name: "gamma" },
      ],
      total_exports: 3,
      total_dead: 2,
      dead_ratio: 0.6667,
    });
  });

  it("counts usage gathered from imports spread across several modules", () => {
    const out = findDeadExports([
      mod("lib", { exports: ["one", "two", "three"] }),
      mod("x", { imports: [{ from: "lib", names: ["one"] }] }),
      mod("y", { imports: [{ from: "lib", names: ["three"] }] }),
    ]);
    const lib = out.modules.find((m) => m.path === "lib");
    assert.deepEqual(lib?.dead_exports, ["two"]);
    assert.equal(lib?.used_count, 2);
  });

  it("does not count an import of a name from a different module as usage", () => {
    const out = findDeadExports([
      mod("a", { exports: ["shared"] }),
      mod("b", { exports: ["shared"] }),
      mod("c", { imports: [{ from: "b", names: ["shared"] }] }),
    ]);
    assert.deepEqual(out.dead_exports, [{ module: "a", name: "shared" }]);
  });

  it("treats importing a name the target does not export as harmless", () => {
    const out = findDeadExports([
      mod("a", { exports: ["real"] }),
      mod("b", { imports: [{ from: "a", names: ["imaginary", "real"] }] }),
    ]);
    assert.deepEqual(out.dead_exports, []);
    assert.equal(out.total_dead, 0);
  });

  it("resolves an import from a module supplied later in the list", () => {
    // The closed-world check runs against the complete set,
    // not just the modules seen so far.
    const out = findDeadExports([
      mod("first", { imports: [{ from: "second", names: ["thing"] }] }),
      mod("second", { exports: ["thing", "other"] }),
    ]);
    assert.deepEqual(out.dead_exports, [{ module: "second", name: "other" }]);
  });
});

describe("findDeadExports — side-effect imports", () => {
  it("uses nothing when an import has an explicit empty names list", () => {
    const out = findDeadExports([
      mod("polyfill", { exports: ["install", "helper"] }),
      mod("app", { imports: [{ from: "polyfill", names: [] }] }),
    ]);
    const polyfill = out.modules.find((m) => m.path === "polyfill");
    assert.deepEqual(polyfill?.dead_exports, ["helper", "install"]);
    assert.equal(polyfill?.used_count, 0);
    assert.equal(out.total_dead, 2);
  });

  it("uses nothing when an import omits names entirely (the default)", () => {
    const omitted = findDeadExports([
      mod("polyfill", { exports: ["install"] }),
      mod("app", { imports: [{ from: "polyfill" }] }),
    ]);
    const explicit = findDeadExports([
      mod("polyfill", { exports: ["install"] }),
      mod("app", { imports: [{ from: "polyfill", names: [] }] }),
    ]);
    assert.deepEqual(omitted, explicit);
    assert.equal(omitted.total_dead, 1);
  });
});

describe("findDeadExports — entry modules", () => {
  it("counts every export of an entry module as used, even with no imports of it", () => {
    const out = findDeadExports([
      mod("main", { exports: ["boot", "config"], entry: true }),
      mod("lib", { exports: ["unused"] }),
    ]);
    const main = out.modules.find((m) => m.path === "main");
    assert.deepEqual(main?.dead_exports, []);
    assert.equal(main?.used_count, 2);
    assert.equal(main?.export_count, 2);
    assert.deepEqual(out.dead_exports, [{ module: "lib", name: "unused" }]);
  });

  it("treats entry: false and an omitted entry the same: exports can be dead", () => {
    const withFalse = findDeadExports([
      mod("a", { exports: ["x"], entry: false }),
    ]);
    const omitted = findDeadExports([mod("a", { exports: ["x"] })]);
    assert.deepEqual(withFalse, omitted);
    assert.equal(withFalse.total_dead, 1);
  });
});

describe("findDeadExports — self-imports and duplicates", () => {
  it("counts a module importing its own names from itself as usage", () => {
    const out = findDeadExports([
      mod("self", {
        exports: ["kept", "dropped"],
        imports: [{ from: "self", names: ["kept"] }],
      }),
    ]);
    assert.deepEqual(out.modules[0].dead_exports, ["dropped"]);
    assert.equal(out.modules[0].used_count, 1);
  });

  it("de-duplicates duplicate names inside one module's exports", () => {
    const out = findDeadExports([
      mod("a", { exports: ["x", "x", "y", "x", "y"] }),
    ]);
    assert.equal(out.modules[0].export_count, 2);
    assert.deepEqual(out.modules[0].dead_exports, ["x", "y"]);
    assert.equal(out.total_exports, 2);
    assert.equal(out.total_dead, 2);
  });

  it("treats duplicate names inside one import's names as harmless", () => {
    const out = findDeadExports([
      mod("a", { exports: ["x", "y"] }),
      mod("b", { imports: [{ from: "a", names: ["x", "x", "x"] }] }),
    ]);
    assert.deepEqual(out.dead_exports, [{ module: "a", name: "y" }]);
  });
});

describe("findDeadExports — sorting, counts, and ratio", () => {
  it("sorts module entries by path ascending (code-unit), independent of input order", () => {
    const graph = [
      mod("zebra", { exports: ["z"] }),
      mod("Alpha", { exports: ["a"] }),
      mod("mid", { exports: ["m"] }),
    ];
    const out = findDeadExports(graph);
    assert.deepEqual(
      out.modules.map((m) => m.path),
      ["Alpha", "mid", "zebra"],
    );
    assert.deepEqual(findDeadExports([...graph].reverse()), out);
  });

  it("sorts each module's dead_exports ascending and reports exact counts", () => {
    const out = findDeadExports([
      mod("a", { exports: ["delta", "bravo", "charlie", "alpha"] }),
      mod("b", { imports: [{ from: "a", names: ["charlie"] }] }),
    ]);
    const a = out.modules.find((m) => m.path === "a");
    assert.deepEqual(a?.dead_exports, ["alpha", "bravo", "delta"]);
    assert.equal(a?.export_count, 4);
    assert.equal(a?.used_count, 1);
  });

  it("sorts the flat dead_exports list by (module, name)", () => {
    const out = findDeadExports([
      mod("b-mod", { exports: ["zeta", "beta"] }),
      mod("a-mod", { exports: ["omega", "alpha"] }),
    ]);
    assert.deepEqual(out.dead_exports, [
      { module: "a-mod", name: "alpha" },
      { module: "a-mod", name: "omega" },
      { module: "b-mod", name: "beta" },
      { module: "b-mod", name: "zeta" },
    ]);
  });

  it("rounds dead_ratio to four decimal places", () => {
    const third = findDeadExports([
      mod("a", { exports: ["x", "y", "z"] }),
      mod("b", { imports: [{ from: "a", names: ["x", "y"] }] }),
    ]);
    assert.equal(third.dead_ratio, 0.3333); // 1/3
    const sixth = findDeadExports([
      mod("a", { exports: ["a1", "a2", "a3", "a4", "a5", "a6"] }),
      mod("b", {
        imports: [{ from: "a", names: ["a1", "a2", "a3", "a4", "a5"] }],
      }),
    ]);
    assert.equal(sixth.dead_ratio, 0.1667); // 1/6 rounds up
    const none = findDeadExports([
      mod("a", { exports: ["x"] }),
      mod("b", { imports: [{ from: "a", names: ["x"] }] }),
    ]);
    assert.equal(none.dead_ratio, 0);
    const all = findDeadExports([mod("a", { exports: ["x", "y"] })]);
    assert.equal(all.dead_ratio, 1);
  });

  it("reports dead_ratio exactly 0 when the set exports nothing", () => {
    const out = findDeadExports([
      mod("a"),
      mod("b", { exports: [], imports: [{ from: "a" }] }),
    ]);
    assert.deepEqual(out, {
      modules: [
        { path: "a", dead_exports: [], used_count: 0, export_count: 0 },
        { path: "b", dead_exports: [], used_count: 0, export_count: 0 },
      ],
      dead_exports: [],
      total_exports: 0,
      total_dead: 0,
      dead_ratio: 0,
    });
  });

  it("treats omitted exports and imports the same as empty ones", () => {
    const omitted = findDeadExports([mod("a"), mod("b", { imports: [{ from: "a", names: [] }] })]);
    const explicit = findDeadExports([
      mod("a", { exports: [], imports: [], entry: false }),
      mod("b", { exports: [], imports: [{ from: "a", names: [] }] }),
    ]);
    assert.deepEqual(omitted, explicit);
  });
});

describe("findDeadExports — pinned judgement calls", () => {
  it("allows an empty string inside an import's names: the spec requires names entries to be strings, and only exports entries must also be non-empty; an empty name matches no export", () => {
    const out = findDeadExports([
      mod("a", { exports: ["x"] }),
      mod("b", { imports: [{ from: "a", names: [""] }] }),
    ]);
    assert.deepEqual(out.dead_exports, [{ module: "a", name: "x" }]);
  });

  it("reports an empty-string import from as naming no supplied module", () => {
    assert.throws(
      () =>
        findDeadExports([
          mod("a"),
          mod("b", { imports: [{ from: "", names: [] }] }),
        ]),
      /modules\[1\]\.imports\[0\]\.from must name a supplied module/,
    );
  });
});

describe("findDeadExports — validation", () => {
  it("rejects missing, empty, or non-array modules", () => {
    assert.throws(() => findDeadExports(undefined), /modules is required/);
    assert.throws(() => findDeadExports([]), /modules must be a non-empty array/);
    assert.throws(() => findDeadExports("nope"), /modules must be a non-empty array/);
    assert.throws(() => findDeadExports(null), /modules must be a non-empty array/);
  });

  it("rejects a module entry that is not an object, naming the path", () => {
    assert.throws(() => findDeadExports([42]), /modules\[0\] must be an object/);
    assert.throws(() => findDeadExports([mod("a"), "b"]), /modules\[1\] must be an object/);
    assert.throws(() => findDeadExports([null]), /modules\[0\] must be an object/);
  });

  it("rejects a module missing its path, naming the path", () => {
    assert.throws(
      () => findDeadExports([{ exports: [] }]),
      /modules\[0\]\.path is required/,
    );
  });

  it("rejects an empty or non-string module path, naming the path", () => {
    assert.throws(
      () => findDeadExports([mod("")]),
      /modules\[0\]\.path must be a non-empty string/,
    );
    assert.throws(
      () => findDeadExports([{ path: 42 }]),
      /modules\[0\]\.path must be a non-empty string/,
    );
  });

  it("rejects a duplicate module path, naming the second occurrence's path", () => {
    assert.throws(
      () => findDeadExports([mod("a"), mod("b"), mod("a")]),
      /modules\[2\]\.path duplicates modules\[0\]\.path "a"/,
    );
  });

  it("rejects a non-array exports field, naming the path", () => {
    assert.throws(
      () => findDeadExports([mod("a", { exports: "x" })]),
      /modules\[0\]\.exports must be an array/,
    );
  });

  it("rejects non-string and empty exports entries, naming the path", () => {
    assert.throws(
      () => findDeadExports([mod("a", { exports: ["ok", 42] })]),
      /modules\[0\]\.exports\[1\] must be a non-empty string/,
    );
    assert.throws(
      () => findDeadExports([mod("a", { exports: [""] })]),
      /modules\[0\]\.exports\[0\] must be a non-empty string/,
    );
  });

  it("rejects a non-array imports field, naming the path", () => {
    assert.throws(
      () => findDeadExports([mod("a", { imports: "b" })]),
      /modules\[0\]\.imports must be an array/,
    );
  });

  it("rejects an import entry that is not an object, naming the path", () => {
    assert.throws(
      () => findDeadExports([mod("a", { imports: ["b"] })]),
      /modules\[0\]\.imports\[0\] must be an object/,
    );
  });

  it("rejects an import missing its from, naming the path", () => {
    assert.throws(
      () => findDeadExports([mod("a", { imports: [{ names: ["x"] }] })]),
      /modules\[0\]\.imports\[0\]\.from is required/,
    );
  });

  it("rejects a non-string import from, naming the path", () => {
    assert.throws(
      () => findDeadExports([mod("a", { imports: [{ from: 42 }] })]),
      /modules\[0\]\.imports\[0\]\.from must be a string/,
    );
  });

  it("rejects an import from an unknown module with the closed-world path-naming message", () => {
    assert.throws(
      () =>
        findDeadExports([
          mod("a", { imports: [{ from: "a", names: [] }, { from: "ghost", names: [] }] }),
        ]),
      /modules\[0\]\.imports\[1\]\.from must name a supplied module/,
    );
  });

  it("rejects a non-array import names field, naming the path", () => {
    assert.throws(
      () =>
        findDeadExports([
          mod("a"),
          mod("b", { imports: [{ from: "a", names: "x" }] }),
        ]),
      /modules\[1\]\.imports\[0\]\.names must be an array/,
    );
  });

  it("rejects a non-string import names entry, naming the path", () => {
    assert.throws(
      () =>
        findDeadExports([
          mod("a", { exports: ["x"] }),
          mod("b", { imports: [{ from: "a", names: ["x", 7] }] }),
        ]),
      /modules\[1\]\.imports\[0\]\.names\[1\] must be a string/,
    );
  });

  it("rejects a non-boolean entry flag, naming the path", () => {
    assert.throws(
      () => findDeadExports([mod("a", { entry: "yes" })]),
      /modules\[0\]\.entry must be a boolean/,
    );
    assert.throws(
      () => findDeadExports([mod("a", { entry: 1 })]),
      /modules\[0\]\.entry must be a boolean/,
    );
  });
});

# deadpath

Codebases accumulate exports nobody uses: a helper written
for a caller that was later deleted, a constant kept "just
in case", a whole module that still ships because something
once imported a name from it. deadpath settles the question
from evidence. You hand it a module set — each module's
path, the names it exports, and the imports it makes — and
it works out which exported names are never imported
anywhere in the set:

- **Per-module summaries** — for every module, its dead
  export names, its total (de-duplicated) export count, and
  how many of its exports are used.
- **A flat dead list** — every dead export as a
  `{module, name}` pair, sorted so it can drive a cleanup
  list or a CI check directly.
- **Set-wide totals** — the total export count, the total
  dead count, and `dead_ratio`: the share of the set's
  exported surface that is dead, rounded to four decimals.

The proof rule is simple. An export is used when some
module in the set imports that name from its module — a
module importing its own names from itself counts, just
like any other import. Entry modules are the one exception:
mark a module `entry: true` and all of its exports count
as used, because an entry point's exports are public
surface consumed from outside the set. An import with an
empty `names` list is a side-effect import: it runs the
target module but uses none of its named exports, so it
keeps nothing alive.

Imports form a closed world: every import's `from` must
name one of the supplied modules. That is what makes a
dead verdict meaningful — the graph is complete by
construction, and an import pointing outside the set is a
validation error naming the offending path (for example
`modules[0].imports[1].from must name a supplied module`),
not a silent gap in the proof. Malformed input of any kind
— a duplicate module path, a bad `exports` entry, a
non-boolean `entry` — fails the same path-naming way, and
no partial report is produced. The computation is pure and
local: no network, no configuration, no files read beyond
the input you pass in.

## CLI

```bash
npx @reneturcios/deadpath find --input args.json
npx @reneturcios/deadpath --version
```

`args.json` contains the full arguments object:

```json
{
  "modules": [
    { "path": "src/main.ts", "exports": ["boot"], "entry": true },
    {
      "path": "src/util.ts",
      "exports": ["fmt", "parse", "legacy"],
      "imports": []
    },
    {
      "path": "src/app.ts",
      "imports": [{ "from": "src/util.ts", "names": ["fmt", "parse"] }]
    }
  ]
}
```

`exports` and `imports` default to `[]` per module, `names`
defaults to `[]` per import, and `entry` defaults to
`false`. Here `legacy` is exported by `src/util.ts` but
imported by nobody, so the report is:

```json
{
  "modules": [
    { "path": "src/app.ts", "dead_exports": [], "used_count": 0, "export_count": 0 },
    { "path": "src/main.ts", "dead_exports": [], "used_count": 1, "export_count": 1 },
    { "path": "src/util.ts", "dead_exports": ["legacy"], "used_count": 2, "export_count": 3 }
  ],
  "dead_exports": [
    { "module": "src/util.ts", "name": "legacy" }
  ],
  "total_exports": 4,
  "total_dead": 1,
  "dead_ratio": 0.25
}
```

Exit codes: `0` on success, `1` on a runtime error
(including an unreadable or invalid input file, or invalid
input), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/deadpath mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "deadpath": {
      "command": "npx",
      "args": ["-y", "@reneturcios/deadpath", "mcp"]
    }
  }
}
```

### Tools

- `find_dead_exports` — Find exported names that no module
  imports.
  - `modules` (array, required, at least one) — modules as
    `{path, exports?, imports?, entry?}` objects; `path` is
    unique across the set, each import is a
    `{from, names?}` object whose `from` names a supplied
    module, and `entry: true` marks a module whose exports
    all count as used

  Returns `{modules, dead_exports, total_exports,
  total_dead, dead_ratio}`.

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/deadpath
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/deadpath find --input /w/args.json
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios

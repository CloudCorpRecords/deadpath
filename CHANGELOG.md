# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `find_dead_exports` MCP tool and `find`
  CLI command finding exported names that no module in a
  supplied set imports.
- Per-module dead-export lists with used and total export
  counts, a flat `{module, name}` list of every dead export,
  set-wide totals, and a dead ratio rounded to four decimal
  places (exactly 0 when the set exports nothing).
- Entry modules' exports all count as used public surface;
  side-effect imports (empty `names`) use nothing; a module
  importing its own names from itself counts as usage; and
  duplicate export names are de-duplicated before counting.
- Closed-world validation: every import's `from` must name
  a supplied module, and malformed input fails with an error
  naming the offending path and no partial result.

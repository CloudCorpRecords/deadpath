/**
 * deadpath types.
 *
 * deadpath looks for exported names that nothing in a module
 * set ever imports. The caller supplies every module in the
 * set — its path, the names it exports, the imports it makes
 * (each import naming the module it comes from and the names
 * taken from it), and whether it is an entry module — and
 * deadpath reports, as pure local computation:
 *
 *   - for every module, which of its exports are dead, how
 *     many exports it has in total, and how many are used
 *   - every dead export in the set as one flat list
 *   - the totals across the set and the share that is dead
 *
 * An export is used when some module imports that name from
 * its module, or when its module is an entry module, whose
 * exports are public surface by definition. An import with
 * an empty `names` list is a side-effect import: it runs the
 * target module but uses none of its named exports. Imports
 * form a closed world — every import's `from` must name one
 * of the supplied modules — so a dead verdict is a proof
 * from the supplied graph, not a guess about code the caller
 * did not include.
 */

/** One import made by a module, as supplied by the caller. */
export interface DeadPathImport {
  /** Path of the module imported from; must be a supplied module. */
  from: string;
  /**
   * Names imported from that module. An empty list is a
   * side-effect import and uses no named exports. Defaults
   * to [] when omitted.
   */
  names: string[];
}

/** One module in the set, as supplied by the caller. */
export interface DeadPathModule {
  /** Module path; unique across the supplied set. */
  path: string;
  /** Names this module exports, de-duplicated. Defaults to []. */
  exports: string[];
  /** Imports this module makes. Defaults to []. */
  imports: DeadPathImport[];
  /**
   * True for entry modules: all their exports count as used
   * public surface. Defaults to false.
   */
  entry: boolean;
}

/** One module's dead-export summary. */
export interface DeadPathModuleEntry {
  /** Module path. */
  path: string;
  /** This module's dead export names, sorted ascending. */
  dead_exports: string[];
  /** Number of this module's exports that are used. */
  used_count: number;
  /** Number of distinct names this module exports. */
  export_count: number;
}

/** One dead export in the flat list. */
export interface DeadPathDeadExport {
  /** Path of the module that exports the name. */
  module: string;
  /** The exported name nothing imports. */
  name: string;
}

/** The dead-export report for a module set. */
export interface DeadPathResult {
  /** Per-module entries, sorted by path ascending. */
  modules: DeadPathModuleEntry[];
  /** Every dead export, sorted by (module asc, name asc). */
  dead_exports: DeadPathDeadExport[];
  /** Sum of the per-module export counts. */
  total_exports: number;
  /** Total number of dead exports in the set. */
  total_dead: number;
  /**
   * total_dead / total_exports, rounded to four decimal
   * places; exactly 0 when the set exports nothing.
   */
  dead_ratio: number;
}

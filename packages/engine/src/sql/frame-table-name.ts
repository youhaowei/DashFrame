/**
 * The frame naming contract: how a DataFrame id spells its DuckDB table.
 *
 * A server-owned DataFrame registers in the engine under exactly one name,
 * derived from its id. Both sides of the chart path depend on that derivation —
 * the transport registers under it, and the chart connector references it in the
 * SQL it sends — so the rule lives here rather than in a copy on each side.
 *
 * The rule replaces a SQL rewrite. The Mosaic route used to require client SQL
 * to mention the double-quoted frame UUID and then string-substituted the table
 * name into it. That regex never provided isolation (any other table named in
 * the same statement ran as written); a naming contract does the job a rewrite
 * was pretending to do.
 *
 * Hyphens become underscores because a raw UUID is not a bare SQL identifier —
 * `df_018f1a50-…` would parse as subtraction unless quoted at every use site.
 */
export function frameTableName(frameId: string): string {
  return `df_${frameId.replaceAll("-", "_")}`;
}

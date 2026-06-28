/**
 * Join type → DuckDB SQL keyword mapping for browser/preview SQL paths.
 *
 * Both "outer" (UI display value) and "full" (persisted config value) represent
 * the same semantic join and both map to "FULL OUTER" — producing "FULL OUTER JOIN".
 *
 * "OUTER JOIN" alone is invalid DuckDB SQL; the correct form is "FULL OUTER JOIN".
 * Using an explicit map instead of `.toUpperCase()` prevents this bug class from
 * recurring when the join type set changes.
 */
const JOIN_TYPE_TO_SQL_KEYWORD: Readonly<
  Record<"inner" | "left" | "right" | "outer" | "full", string>
> = {
  inner: "INNER",
  left: "LEFT",
  right: "RIGHT",
  outer: "FULL OUTER", // UI display value → FULL OUTER JOIN
  full: "FULL OUTER", // persisted config value → FULL OUTER JOIN
};

/**
 * Returns the DuckDB SQL keyword fragment for the given join type.
 *
 * The returned fragment is inserted immediately before the JOIN keyword:
 *   `${joinTypeToSQL(type)} JOIN …`
 *
 * Throws for unrecognised types (fail-closed: never emit `undefined JOIN`).
 */
export function joinTypeToSQL(type: string): string {
  const keyword = (
    JOIN_TYPE_TO_SQL_KEYWORD as Record<string, string | undefined>
  )[type];
  if (keyword === undefined) {
    throw new Error(
      `joinTypeToSQL: unknown join type "${type}" — must be one of: ${Object.keys(JOIN_TYPE_TO_SQL_KEYWORD).join(", ")}`,
    );
  }
  return keyword;
}

/** Exported for white-box testing of the mapping table itself. */
export { JOIN_TYPE_TO_SQL_KEYWORD };

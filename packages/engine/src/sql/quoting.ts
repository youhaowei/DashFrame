/**
 * SQL quoting utilities for DuckDB (ANSI SQL-compatible).
 *
 * - `quoteIdentifier` — wraps table/column names in double-quotes and escapes
 *   embedded double-quotes by doubling them (`"` → `""`).
 * - `quoteLiteral`   — wraps string values in single-quotes and escapes
 *   embedded single-quotes by doubling them (`'` → `''`).
 *
 * These are deliberately kept separate: identifiers use double-quote quoting,
 * string values use single-quote quoting. Mixing them up is a SQL injection
 * class of bug in the opposite direction — don't.
 */

/**
 * Quote a SQL identifier (table name, column name) for DuckDB / ANSI SQL.
 *
 * Wraps the name in double-quotes and escapes any embedded double-quotes by
 * doubling them. This allows identifiers that contain spaces, reserved words,
 * or special characters (including quotes) to be used safely in SQL.
 *
 * @example
 * quoteIdentifier("order")         // `"order"`
 * quoteIdentifier("first name")    // `"first name"`
 * quoteIdentifier(`weird"name`)    // `"weird""name"`
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Quote a SQL string literal for DuckDB / ANSI SQL.
 *
 * Wraps the value in single-quotes and escapes any embedded single-quotes by
 * doubling them.
 *
 * @example
 * quoteLiteral("O'Brien")   // `'O''Brien'`
 * quoteLiteral("hello")     // `'hello'`
 */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * How DuckDB identifies a table, as opposed to how it spells it.
 *
 * Identifiers are case-insensitive even when quoted, so `"Sales"` and
 * `"sales"` name ONE catalog entry — probed at 20/20 cross-case write-write
 * conflicts against @duckdb/node-api 1.5.3-r.3. Anything that has to decide
 * whether two names mean the same table — a registration lock, a registry of
 * what is registered — keys on this rather than on the raw string.
 *
 * The fold is ASCII-only because DuckDB's is: probed on the same version,
 * `"Ä"`/`"ä"`, `"İ"`/`"i̇"` and `"ß"`/`"ss"` each create two distinct catalog
 * tables, while `"A"`/`"a"` create one. `String.toLowerCase()` would merge the
 * first pair and leave a registry claiming one table where DuckDB has two.
 */
export function tableKey(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

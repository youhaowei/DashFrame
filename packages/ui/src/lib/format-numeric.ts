/**
 * Display-layer numeric formatting for aggregate query results.
 *
 * DuckDB float arithmetic can produce IEEE-754 noise tails
 * (e.g. SUM(amount) = 409.95000000000005 instead of 409.95).
 * This formatter strips that noise at the display boundary without
 * mutating the underlying value.
 *
 * Strategy: round to 10 significant digits via `toPrecision`, then
 * parse back to a number so JavaScript drops trailing zeros naturally
 * (`parseFloat("409.9500000000"`) → 409.95`). 10 sig-figs preserves
 * real precision for values like 1234.5678 while eliminating the
 * sub-ULP error that appears in the 15th–16th digit.
 *
 * Rules:
 * - Integers: returned as-is (no decimal point introduced).
 * - Already-clean decimals: unchanged (e.g. "409.95" stays "409.95").
 * - Very long but genuinely precise decimals: rounded to 10 sig-figs,
 *   which is the practical limit of DuckDB DOUBLE precision anyway.
 * - Non-finite (Infinity, -Infinity, NaN): returned as String(n).
 */
export function formatNumeric(n: number): string {
  if (!isFinite(n)) return String(n);
  // Integers are already exact — skip toPrecision so that values like
  // COUNT(*) = 12345678901 are never rounded to 12345678900.
  if (Number.isInteger(n)) return String(n);
  // toPrecision(10) → "4.095000000e+2" style strings for large exponents;
  // parseFloat normalises them back to the plain decimal representation.
  return String(parseFloat(n.toPrecision(10)));
}

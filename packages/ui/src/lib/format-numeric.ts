/**
 * Display-layer numeric formatting for aggregate query results.
 *
 * DuckDB float arithmetic can produce IEEE-754 noise tails
 * (e.g. SUM(amount) = 409.95000000000005 instead of 409.95).
 * This formatter strips that noise at the display boundary without
 * mutating the underlying value.
 *
 * Strategy: round to 15 significant digits via `toPrecision`, then
 * parse back to a number so JavaScript drops trailing zeros naturally
 * (`parseFloat("409.950000000000"`) → 409.95`). 15 sig-figs preserves
 * the meaningful precision of a JavaScript Number while eliminating
 * ordinary binary floating-point noise in its final digits.
 *
 * Rules:
 * - Integers: returned as-is (no decimal point introduced).
 * - Already-clean decimals: unchanged (e.g. "409.95" stays "409.95").
 * - Very long decimals: preserve up to 15 significant digits, the meaningful
 *   decimal precision of a DuckDB DOUBLE represented as a JavaScript Number.
 * - Non-finite (Infinity, -Infinity, NaN): returned as String(n).
 */
export function formatNumeric(n: number): string {
  if (!isFinite(n)) return String(n);
  // Integers are already exact — skip toPrecision so that values like
  // COUNT(*) = 12345678901 are never rounded to 12345678900.
  if (Number.isInteger(n)) return String(n);
  // toPrecision(15) → "4.09500000000000e+2" style strings for large exponents;
  // parseFloat normalises them back to the plain decimal representation.
  return String(parseFloat(n.toPrecision(15)));
}

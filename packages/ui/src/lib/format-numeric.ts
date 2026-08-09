/**
 * Convert a numeric value to its exact JavaScript display representation.
 *
 * JavaScript numbers do not retain source scale or precision metadata. Once a
 * value reaches this generic display boundary, an intentional low-order bit is
 * indistinguishable from a floating-point arithmetic artifact. Fixed-precision
 * rounding therefore corrupts legitimate values such as `1 + Number.EPSILON`.
 *
 * `String` returns JavaScript's shortest decimal representation that parses
 * back to the same Number. Source-aware callers may apply a product-specific
 * format before this boundary when they have an explicit precision contract.
 */
export function formatNumeric(n: number): string {
  return String(n);
}

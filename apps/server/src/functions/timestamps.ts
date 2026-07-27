/**
 * Timestamp coalescing shared by the read-path mappers.
 *
 * A pure leaf (value in, millis out) so the DTO codecs can convert row
 * timestamps without importing back from their consumer (`app-artifacts.ts`),
 * which would re-form a module cycle.
 */

/**
 * Coalesce a row timestamp to epoch ms, null-safe.
 *
 * Canonical artifact tables stamp `created_at` with a DB default, so a canonical
 * read always has it. But the DRAFT-OVERLAY view coalesces canonical ⊕ the sparse
 * `<table>__draft` delta, and the draft shadow leaves `created_at` NULL for an
 * artifact CREATED inside a draft (it has no canonical base, and publish stamps
 * the real value). A draft-created artifact read through the overlay therefore
 * carries a null timestamp until publish — `.getTime()` on it throws. Coalesce
 * null → 0 (epoch): the artifact is unpublished, so it has no real creation time
 * yet; 0 is the honest placeholder the read path can surface without crashing.
 * `updatedAt` stays optional (null → undefined) via `?.getTime()` at call sites.
 */
export function tsToMillis(value: Date | null | undefined): number {
  return value != null ? value.getTime() : 0;
}

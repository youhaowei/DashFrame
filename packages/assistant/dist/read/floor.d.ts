/**
 * The privacy FLOOR — the single VALUE-egress gate for the assistant's reads.
 *
 * THE WHOLE VALUE OF THIS FILE IS BEING AUDITABLE AT A GLANCE. v0.3 is ONE rule,
 * binary, inherit-source:
 *
 *   A column is sensitive or it isn't (use the canonical Field.sensitivity enum
 *   from @dashframe/types — `cleared` is the ONLY unrestricted state; `sensitive`
 *   and `unclassified` both restrict, fail-closed). A data read INHERITS its
 *   SOURCE columns' sensitivity: if ANY column the artifact reads from is
 *   restricted, the whole data read is MASKED.
 *
 * That is IT. NO result-level classification, NO k-anonymity, NO per-tier
 * cleverness — those are deferred (a future result-classification pass). STRUCTURE
 * (column names, types, the sensitivity marker itself) ALWAYS flows ungated; only
 * ROW/VALUE data is gated, and in v0.3 "gated" means profiles-only regardless
 * (see below).
 *
 * SINGLE DATA-EGRESS BOUNDARY: all VALUE data goes through the perception
 * assembler. THE PERCEPTION ASSEMBLER IS NOT BUILT YET — so v0.3 `readData`
 * returns PROFILES-ONLY (column stats / shape / type, never raw rows) as the
 * floor-held default. This is the correct conservative floor until it exists: an
 * unmasked read still emits no rows, a masked read emits the same profiles
 * flagged `masked: true`. When the assembler lands, the tiered
 * profile→obfuscated→real sample plugs in HERE (the `applyFloor` seam), and the
 * masked/unmasked decision computed here selects the tier. Nothing else in the
 * read layer changes.
 */
import type { Field } from "@dashframe/types";
import type { ColumnProfile, DataReadResult, NodeRef } from "./port.js";
/**
 * The inherit-source decision, in one place: is this set of source fields
 * restricted? TRUE iff ANY field is not `cleared` (fail-closed — `unclassified`
 * counts as restricted, exactly as `isFieldRestricted` defines the floor).
 *
 * This is the load-bearing binary. A masked read profiles/obfuscates; an
 * unmasked read may (once the perception assembler lands) surface a real sample.
 * There is no middle tier and there is no per-column gating of the OUTPUT — one
 * sensitive contributing column masks the entire read. Coarse on purpose:
 * auditable at a glance.
 */
export declare function isMaskedBySource(sourceFields: ReadonlyArray<Pick<Field, "sensitivity">>): boolean;
/**
 * Build the per-column profiles — SHAPE, never raw rows. Every profile carries
 * the column's OWN sensitivity (structure: the marker always flows). `stats` are
 * non-row aggregates (counts) safe at every tier; callers pass what the source
 * has, or omit. This is the only value-shaped data v0.3 emits, masked or not.
 */
export declare function profileColumns(fields: ReadonlyArray<Pick<Field, "name" | "type" | "sensitivity"> & {
    stats?: ColumnProfile["stats"];
}>): ColumnProfile[];
/**
 * Assemble the floor-gated data-read result for a node from its CONTRIBUTING
 * source fields. The single VALUE sink: every `readData` path lands here.
 *
 * `masked` is the inherit-source binary over the source fields; `columns` is the
 * profiles-only shape (always emitted, ungated structure). `sample` is never set
 * in v0.3 — the perception assembler plugs the tiered real/obfuscated sample in
 * at this exact seam, selected by `masked`.
 *
 * FAIL-CLOSED on incomplete resolution. `isMaskedBySource([])` is `false` (an
 * empty `.some()`), which would be a FAIL-OPEN if the caller couldn't fully
 * resolve an artifact's contributing columns (e.g. an insight whose source chain
 * or metric/join column the host couldn't walk). The caller passes
 * `forceMask: true` to mask regardless of the field set — "I am not certain I saw
 * every contributing column, so mask." A masked read is always safe (profiles
 * only, no values); an unmasked-but-incomplete read is the leak. The floor
 * therefore ORs the caller's force signal with the field-derived binary: the
 * resolver can only ever make the read MORE restrictive, never less.
 */
export declare function applyFloor(node: NodeRef, sourceFields: ReadonlyArray<Pick<Field, "name" | "type" | "sensitivity"> & {
    stats?: ColumnProfile["stats"];
}>, opts?: {
    forceMask?: boolean;
}): DataReadResult;
//# sourceMappingURL=floor.d.ts.map
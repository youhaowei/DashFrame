/**
 * The privacy FLOOR — the single VALUE-egress gate for the assistant's reads.
 *
 * THE WHOLE VALUE OF THIS FILE IS BEING AUDITABLE AT A GLANCE. The floor is ONE rule,
 * binary, inherit-source:
 *
 *   A column is sensitive or it isn't (use the canonical Field.sensitivity enum
 *   from @dashframe/types — `cleared` is the ONLY unrestricted state; `sensitive`
 *   and `unclassified` both restrict, fail-closed). A data read INHERITS its
 *   SOURCE columns' sensitivity: if ANY column the artifact reads from is
 *   restricted, the read is flagged MASKED.
 *
 * That is IT. NO result-level classification, NO k-anonymity, NO per-tier
 * cleverness — those are deferred (a future result-classification pass). STRUCTURE
 * (column names, types, the sensitivity marker itself) ALWAYS flows ungated; only
 * ROW/VALUE data is gated: cleared sample columns may flow raw, while restricted
 * columns are obfuscated. If lineage is incomplete, every sample value is
 * obfuscated.
 *
 * SINGLE DATA-EGRESS BOUNDARY: all VALUE data goes through the perception
 * assembler. `readData` always returns column profiles (stats / shape /
 * type). When the host supplies sample rows, the assembler adds a bounded
 * sample: cleared columns may surface raw values; restricted columns are
 * obfuscated. Hosts without a safe sampler still remain profiles-only.
 */
import type { Field } from "@dashframe/types";
import { type PerceptionAssemblerOptions } from "./perception.js";
import type { ColumnProfile, DataReadResult, NodeRef } from "./port.js";
/**
 * The inherit-source decision, in one place: is this set of source fields
 * restricted? TRUE iff ANY field is not `cleared` (fail-closed — `unclassified`
 * counts as restricted, exactly as `isFieldRestricted` defines the floor).
 *
 * This is the load-bearing binary for whether protected data is present. It does
 * not mean every sample value is hidden: the perception assembler can still keep
 * cleared columns raw while obfuscating restricted columns.
 */
export declare function isMaskedBySource(sourceFields: ReadonlyArray<Pick<Field, "sensitivity">>): boolean;
/**
 * Build the per-column profiles — SHAPE, never raw rows. Every profile carries
 * the column's OWN sensitivity (structure: the marker always flows). `stats` are
 * non-row aggregates (counts) safe at every tier; callers pass what the source
 * has, or omit. Row samples, when provided, are assembled separately under the
 * floor's raw/obfuscated budget.
 */
export declare function profileColumns(fields: ReadonlyArray<Pick<Field, "name" | "type" | "sensitivity"> & {
    stats?: ColumnProfile["stats"];
}>): ColumnProfile[];
/**
 * Assemble the floor-gated data-read result for a node from its CONTRIBUTING
 * source fields. The single VALUE sink: every `readData` path lands here.
 *
 * `masked` is the inherit-source binary over the source fields; `columns` is the
 * always-present profile shape. When sample rows are supplied, the perception
 * assembler plugs a tiered raw/mixed/obfuscated sample in at this exact seam,
 * selected by column sensitivity. `forceMask` masks every value because the host
 * could not prove complete lineage.
 *
 * FAIL-CLOSED on incomplete resolution. `isMaskedBySource([])` is `false` (an
 * empty `.some()`), which would be a FAIL-OPEN if the caller couldn't fully
 * resolve an artifact's contributing columns (e.g. an insight whose source chain
 * or metric/join column the host couldn't walk). The caller passes
 * `forceMask: true` to mask regardless of the field set — "I am not certain I saw
 * every contributing column, so mask." A forced mask is always safe; an
 * unmasked-but-incomplete read is the leak. The floor
 * therefore ORs the caller's force signal with the field-derived binary: the
 * resolver can only ever make the read MORE restrictive, never less.
 */
export declare function applyFloor(node: NodeRef, sourceFields: ReadonlyArray<Pick<Field, "name" | "type" | "sensitivity"> & {
    stats?: ColumnProfile["stats"];
}>, opts?: {
    forceMask?: boolean;
} & PerceptionAssemblerOptions): DataReadResult;
//# sourceMappingURL=floor.d.ts.map
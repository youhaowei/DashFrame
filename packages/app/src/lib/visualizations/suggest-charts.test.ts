/**
 * Repeat-join identity tests for suggest-charts.
 *
 * When the same table is joined twice (repeat-join), the SQL layer produces
 * column aliases with _j0 and _j1 instance suffixes (e.g.
 * `field_dd05ef4b_..._j0` and `field_dd05ef4b_..._j1`). These two columns
 * carry different data and must be treated as distinct by the suggestion engine.
 *
 * Invariant: _j1 never collapses to _j0 in suggestion IDs or suggestion output.
 * Single-join (no suffix) must not regress.
 *
 * Design pin: `enrichColumnAnalysis` keeps `fieldId` as the canonical UUID
 * (bare UUID, NOT instance-qualified) so that `fields[fieldId]` resolves for
 * BOTH j0 and j1. The `fields` map (from InsightView.tsx's `fieldMap`) is keyed
 * only by bare UUIDs — instance-qualifying `fieldId` would make j1's metadata
 * lookup return `undefined` (no display name, no isBlocked check). Instance
 * identity is tracked via `instanceIndex` / `instanceIdSuffix` instead.
 */
import type { ColumnAnalysis, UUID } from "@dashframe/types";
import { describe, expect, it } from "vitest";
import type { Insight } from "../stores/types";
import { suggestByChartType, suggestCharts } from "./suggest-charts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STUB_INSIGHT: Insight = {
  id: "insight-1" as UUID,
  name: "Test",
  baseTable: { tableId: "table-1" as UUID, selectedFields: [] },
  metrics: [],
  createdAt: 0,
  updatedAt: 0,
};

// ── Repeat-join fixtures (COL_J0 / COL_J1) ───────────────────────────────────
// When the same table is joined twice the engine produces:
//   first instance  → bare alias (NO _j0 suffix): field_<uuid>
//   second instance → _j1-suffixed alias:         field_<uuid>_j1
// COL_J0 uses the bare alias because that is what the engine emits for
// instanceIndex === 0 (see insight-sql.ts joinInstanceFieldId).
const BASE_UUID = "dd05ef4b-1234-5678-abcd-ef1234567890";
const COL_J0 = `field_${BASE_UUID.replace(/-/g, "_")}`; // bare = first instance
const COL_J1 = `${COL_J0}_j1`; // _j1 suffix = second instance

// ── Single-join fixture (COL_SINGLE) ─────────────────────────────────────────
// A column that comes from a table joined exactly once — also a bare alias,
// but uses a DISTINCT UUID so single-join regression tests are unambiguous.
const SINGLE_UUID = "ccbbaa99-1234-5678-abcd-ef1234567890";
const COL_SINGLE = `field_${SINGLE_UUID.replace(/-/g, "_")}`;

// Numerical column that is distinct from the categorical ones above
const NUM_UUID = "aabbccdd-1234-5678-abcd-ef1234567890";
const COL_NUM = `field_${NUM_UUID.replace(/-/g, "_")}`;

// Second numerical column (different UUID) for testing numerical fallback
const NUM2_UUID = "11223344-1234-5678-abcd-ef1234567890";
const COL_NUM2 = `field_${NUM2_UUID.replace(/-/g, "_")}`;

function makeCategorical(columnName: string, cardinality = 10): ColumnAnalysis {
  return {
    columnName,
    dataType: "string",
    semantic: "categorical",
    cardinality,
    uniqueness: 0.5,
    nullCount: 0,
    sampleValues: ["a", "b"],
  };
}

function makeNumerical(columnName: string): ColumnAnalysis {
  return {
    columnName,
    dataType: "number",
    semantic: "numerical",
    cardinality: 100,
    uniqueness: 1,
    nullCount: 0,
    sampleValues: [1, 2, 3],
    min: 1,
    max: 1000,
  };
}

// ── suggestByChartType — repeat-join fallback ─────────────────────────────────

describe("suggestByChartType — repeat-join instance identity", () => {
  it("returns j1 suggestion when j0 encoding is excluded (barY)", () => {
    // Arrange: both j0 and j1 are valid categorical X-axis candidates
    const analysis: ColumnAnalysis[] = [
      makeCategorical(COL_J0),
      makeCategorical(COL_J1),
      makeNumerical(COL_NUM),
    ];
    // Simulate that a barY chart using j0 already exists
    const j0Sig = `${COL_J0}|sum(${COL_NUM})|`;
    const excludeEncodings = new Set([j0Sig]);

    const suggestion = suggestByChartType(
      STUB_INSIGHT,
      analysis,
      1000,
      {},
      "barY",
      { excludeEncodings },
    );

    // After fix: j1 must be used when j0 is excluded
    expect(suggestion).not.toBeNull();
    expect(suggestion!.encoding.x).toBe(COL_J1);
  });

  it("returns a suggestion when neither instance is excluded (barY) — one of j0 or j1", () => {
    // Note: shuffleWithSeed may reorder columns; the contract is that ONE valid
    // suggestion is returned and its encoding preserves the actual column alias.
    const analysis: ColumnAnalysis[] = [
      makeCategorical(COL_J0),
      makeCategorical(COL_J1),
      makeNumerical(COL_NUM),
    ];

    const suggestion = suggestByChartType(
      STUB_INSIGHT,
      analysis,
      1000,
      {},
      "barY",
    );

    expect(suggestion).not.toBeNull();
    // The encoding must use the ACTUAL column alias (j0 or j1, not a bare UUID)
    expect([COL_J0, COL_J1]).toContain(suggestion!.encoding.x);
  });

  it("returns null only when both j0 and j1 are excluded (barY)", () => {
    const analysis: ColumnAnalysis[] = [
      makeCategorical(COL_J0),
      makeCategorical(COL_J1),
      makeNumerical(COL_NUM),
    ];
    const j0Sig = `${COL_J0}|sum(${COL_NUM})|`;
    const j1Sig = `${COL_J1}|sum(${COL_NUM})|`;
    const excludeEncodings = new Set([j0Sig, j1Sig]);

    const suggestion = suggestByChartType(
      STUB_INSIGHT,
      analysis,
      1000,
      {},
      "barY",
      { excludeEncodings },
    );

    expect(suggestion).toBeNull();
  });

  it("j0 and j1 produce distinct suggestion IDs (barY)", () => {
    const onlyJ0: ColumnAnalysis[] = [
      makeCategorical(COL_J0),
      makeNumerical(COL_NUM),
    ];
    const onlyJ1: ColumnAnalysis[] = [
      makeCategorical(COL_J1),
      makeNumerical(COL_NUM),
    ];

    const s0 = suggestByChartType(STUB_INSIGHT, onlyJ0, 1000, {}, "barY");
    const s1 = suggestByChartType(STUB_INSIGHT, onlyJ1, 1000, {}, "barY");

    expect(s0).not.toBeNull();
    expect(s1).not.toBeNull();
    expect(s0!.id).not.toBe(s1!.id);
  });

  it("single-join (no _j suffix) — suggestion ID does not include _j suffix", () => {
    // COL_SINGLE is a column from a table joined exactly once (bare alias,
    // no _j suffix). Its suggestion ID must not gain an instance suffix.
    const analysis: ColumnAnalysis[] = [
      makeCategorical(COL_SINGLE),
      makeNumerical(COL_NUM),
    ];

    const suggestion = suggestByChartType(
      STUB_INSIGHT,
      analysis,
      1000,
      {},
      "barY",
    );

    expect(suggestion).not.toBeNull();
    expect(suggestion!.id).not.toMatch(/_j\d+/);
  });
});

// ── numerical-candidate iteration ─────────────────────────────────────────────
//
// barY and barX iterate over BOTH numerical and categorical candidates, so a
// suggestion is returned even when all xJ0/yNum0 and xJ1/yNum0 combos are
// excluded but xJ0/yNum1 (alternate numerical column) is not.

describe("suggestByChartType — numerical candidate fallback (barY)", () => {
  it("returns a suggestion using the alternate numerical column when num0 combos are all excluded", () => {
    const analysis: ColumnAnalysis[] = [
      makeCategorical(COL_J0),
      makeCategorical(COL_J1),
      makeNumerical(COL_NUM), // num0 — all combos excluded below
      makeNumerical(COL_NUM2), // num1 — should be tried as fallback
    ];
    // Exclude every combination of categorical × num0
    const excludeEncodings = new Set([
      `${COL_J0}|sum(${COL_NUM})|`,
      `${COL_J1}|sum(${COL_NUM})|`,
    ]);

    const suggestion = suggestByChartType(
      STUB_INSIGHT,
      analysis,
      1000,
      {},
      "barY",
      { excludeEncodings },
    );

    // Must return a suggestion using num1 (not null)
    expect(suggestion).not.toBeNull();
    expect(suggestion!.encoding.y).toBe(`sum(${COL_NUM2})`);
  });

  it("returns null only when all numerical × categorical combinations are excluded (barY)", () => {
    const analysis: ColumnAnalysis[] = [
      makeCategorical(COL_J0),
      makeNumerical(COL_NUM),
      makeNumerical(COL_NUM2),
    ];
    const excludeEncodings = new Set([
      `${COL_J0}|sum(${COL_NUM})|`,
      `${COL_J0}|sum(${COL_NUM2})|`,
    ]);

    const suggestion = suggestByChartType(
      STUB_INSIGHT,
      analysis,
      1000,
      {},
      "barY",
      { excludeEncodings },
    );

    expect(suggestion).toBeNull();
  });
});

// ── canonical-UUID resolution — fieldId metadata lookup ───────────────────────
//
// This describe block pins the design decision that `fieldId` must remain the
// canonical UUID (not instance-qualified) so that `fields[fieldId]` resolves
// correctly for BOTH j0 and j1 of the same base field.
// A refactor that instance-qualifies fieldId would break this test.

describe("suggestByChartType — canonical-UUID fieldId resolves j1 metadata", () => {
  it("j1 suggestion title uses the field's display name, not the raw alias", () => {
    // The base field has a human-readable name stored by UUID key
    const fields: Record<string, import("@dashframe/types").Field> = {
      [BASE_UUID]: {
        id: BASE_UUID as import("@dashframe/types").UUID,
        name: "City",
        columnName: COL_J0,
        isIdentifier: false,
        isReference: false,
        dataType: "string",
      },
    };

    // Only the j1 instance is in the analysis
    const analysis: ColumnAnalysis[] = [
      makeCategorical(COL_J1),
      makeNumerical(COL_NUM),
    ];

    const suggestion = suggestByChartType(
      STUB_INSIGHT,
      analysis,
      1000,
      fields, // populated map keyed by canonical UUID
      "barY",
    );

    expect(suggestion).not.toBeNull();
    // Title must use "City" (from fields map via canonical UUID), NOT the raw alias
    expect(suggestion!.title).toContain("City");
    // Encoding must still use the actual j1 column alias (not bare UUID)
    expect(suggestion!.encoding.x).toBe(COL_J1);
  });
});

// ── suggestCharts — distinct IDs for j0/j1 ───────────────────────────────────

describe("suggestCharts — repeat-join instance identity", () => {
  it("j0 and j1 categorical columns produce suggestions with distinct IDs", () => {
    const analysisWithJ0: ColumnAnalysis[] = [
      makeCategorical(COL_J0),
      makeNumerical(COL_NUM),
    ];
    const analysisWithJ1: ColumnAnalysis[] = [
      makeCategorical(COL_J1),
      makeNumerical(COL_NUM),
    ];

    const suggestionsJ0 = suggestCharts(STUB_INSIGHT, analysisWithJ0, 1000, {});
    const suggestionsJ1 = suggestCharts(STUB_INSIGHT, analysisWithJ1, 1000, {});

    const idsJ0 = suggestionsJ0.map((s) => s.id);
    const idsJ1 = suggestionsJ1.map((s) => s.id);

    // IDs must be completely disjoint between j0-based and j1-based suggestions
    const overlap = idsJ0.filter((id) => idsJ1.includes(id));
    expect(overlap).toHaveLength(0);
  });
});

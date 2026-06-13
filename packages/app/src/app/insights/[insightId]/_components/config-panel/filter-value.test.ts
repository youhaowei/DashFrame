import { describe, expect, it } from "vitest";
import {
  buildFilterValue,
  isFilterDraftValid,
  type FilterDraft,
} from "./filter-value";

/**
 * These tests lock the filter draft validation/build contract — the seam the
 * Save button gates on. Each case maps to a correctness bug: a draft that
 * validates must never produce SQL-breaking persisted values (NaN, empty IN).
 */

function draft(overrides: Partial<FilterDraft>): FilterDraft {
  return {
    field: "amount",
    operator: "eq",
    inputType: "text",
    scalarValue: "",
    betweenLow: "",
    betweenHigh: "",
    ...overrides,
  };
}

describe("isFilterDraftValid", () => {
  it("rejects a draft with no field selected", () => {
    expect(isFilterDraftValid(draft({ field: "", scalarValue: "x" }))).toBe(
      false,
    );
  });

  describe("scalar operators", () => {
    it("accepts a non-empty text value", () => {
      expect(isFilterDraftValid(draft({ scalarValue: "foo" }))).toBe(true);
    });

    it("rejects an empty scalar value", () => {
      expect(isFilterDraftValid(draft({ scalarValue: "   " }))).toBe(false);
    });

    it("rejects a non-finite number on a numeric field", () => {
      expect(
        isFilterDraftValid(draft({ inputType: "number", scalarValue: "abc" })),
      ).toBe(false);
    });

    it("accepts a finite number on a numeric field", () => {
      expect(
        isFilterDraftValid(draft({ inputType: "number", scalarValue: "42" })),
      ).toBe(true);
    });
  });

  describe("between operator", () => {
    it("rejects when either bound is empty", () => {
      expect(
        isFilterDraftValid(
          draft({ operator: "between", betweenLow: "1", betweenHigh: "" }),
        ),
      ).toBe(false);
    });

    it("rejects non-finite numeric bounds", () => {
      expect(
        isFilterDraftValid(
          draft({
            operator: "between",
            inputType: "number",
            betweenLow: "1",
            betweenHigh: "xyz",
          }),
        ),
      ).toBe(false);
    });

    it("accepts finite numeric bounds", () => {
      expect(
        isFilterDraftValid(
          draft({
            operator: "between",
            inputType: "number",
            betweenLow: "1",
            betweenHigh: "10",
          }),
        ),
      ).toBe(true);
    });
  });

  describe("in operator", () => {
    it("rejects an all-comma input that parses to an empty list", () => {
      // Bug: "," passes the trim() !== "" guard but split→filter yields [].
      // IN () is always-false SQL — must be rejected.
      expect(
        isFilterDraftValid(draft({ operator: "in", scalarValue: "," })),
      ).toBe(false);
    });

    it("rejects whitespace-only tokens that collapse to an empty list", () => {
      expect(
        isFilterDraftValid(draft({ operator: "in", scalarValue: " , , " })),
      ).toBe(false);
    });

    it("rejects a non-finite element on a numeric field", () => {
      // Bug: "in"+numeric skipped the isFinite check and stored [NaN, 2024].
      expect(
        isFilterDraftValid(
          draft({
            operator: "in",
            inputType: "number",
            scalarValue: "abc, 2024",
          }),
        ),
      ).toBe(false);
    });

    it("accepts all-finite numeric elements", () => {
      expect(
        isFilterDraftValid(
          draft({
            operator: "in",
            inputType: "number",
            scalarValue: "1, 2, 3",
          }),
        ),
      ).toBe(true);
    });

    it("accepts non-empty text elements", () => {
      expect(
        isFilterDraftValid(draft({ operator: "in", scalarValue: "a, b" })),
      ).toBe(true);
    });
  });
});

describe("buildFilterValue", () => {
  it("coerces a numeric scalar to a number", () => {
    expect(
      buildFilterValue(draft({ inputType: "number", scalarValue: "42" })),
    ).toBe(42);
  });

  it("keeps a text scalar as a string", () => {
    expect(buildFilterValue(draft({ scalarValue: "north" }))).toBe("north");
  });

  it("builds a { low, high } object for between", () => {
    expect(
      buildFilterValue(
        draft({
          operator: "between",
          inputType: "number",
          betweenLow: "1",
          betweenHigh: "10",
        }),
      ),
    ).toEqual({ low: 1, high: 10 });
  });

  it("builds a numeric array for in on a numeric field", () => {
    expect(
      buildFilterValue(
        draft({ operator: "in", inputType: "number", scalarValue: "1, 2, 3" }),
      ),
    ).toEqual([1, 2, 3]);
  });

  it("builds a trimmed string array for in on a text field", () => {
    expect(
      buildFilterValue(draft({ operator: "in", scalarValue: " a , b ,c" })),
    ).toEqual(["a", "b", "c"]);
  });
});

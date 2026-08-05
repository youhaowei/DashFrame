import { describe, expect, it } from "vitest";

import {
  DRAFT_DRIFT_DESCRIPTION,
  draftLifecycleErrorDescription,
  isDriftError,
  previewFailureDetail,
  previewFailureSummary,
} from "./user-facing-errors";

describe("preview user-facing errors", () => {
  it("describes preview failures without raw server text", () => {
    expect(previewFailureSummary(2)).toContain("Command 3");
    expect(previewFailureDetail()).not.toMatch(/duckdb|sql/i);
  });

  it("maps known draft lifecycle errors", () => {
    expect(
      draftLifecycleErrorDescription(
        new Error("publishDraft: draft contains unbound late-bound operands"),
      ),
    ).toContain("binding");
    expect(draftLifecycleErrorDescription(new Error("network timeout"))).toBe(
      "Please try again.",
    );
  });

  it("classifies drift separately from every other failure", () => {
    for (const drift of [
      "publishDraft: draft changed since review",
      "publishDraft: draft changed since review — no open draft abc",
      "reviseDraft: content drift",
      "reviseDraft: count mismatch",
    ]) {
      expect(isDriftError(new Error(drift))).toBe(true);
    }

    // A security denial or a transport failure must NOT read as drift — that
    // would tell the reviewer to reload and retry an action they can never
    // perform.
    for (const other of [
      "Forbidden: commands.commit",
      "network timeout",
      "draftBatch: no open draft abc",
    ]) {
      expect(isDriftError(new Error(other))).toBe(false);
    }
    expect(isDriftError(undefined)).toBe(false);

    // The drift copy is the manifest's wording, and the generic fallback never
    // duplicates it.
    expect(DRAFT_DRIFT_DESCRIPTION).toContain("while you were reviewing it");
    expect(
      draftLifecycleErrorDescription(
        new Error("publishDraft: draft changed since review"),
      ),
    ).not.toBe(DRAFT_DRIFT_DESCRIPTION);
  });
});

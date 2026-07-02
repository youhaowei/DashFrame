import { describe, expect, it } from "vitest";

import {
  draftLifecycleErrorDescription,
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
    expect(
      draftLifecycleErrorDescription(
        new Error("publishDraft: draft changed since review"),
      ),
    ).toContain("Refresh");
    expect(draftLifecycleErrorDescription(new Error("network timeout"))).toBe(
      "Please try again.",
    );
  });
});

import { describe, expect, it } from "vite-plus/test";
import {
  formatReportContentsCount,
  formatSavedViewType,
  reportQuestionLink,
} from "./DashboardDetailContent";

describe("formatReportContentsCount", () => {
  it("uses factual singular and plural labels for both nested artifact types", () => {
    expect(formatReportContentsCount(0, 0)).toBe("0 questions · 0 saved views");
    expect(formatReportContentsCount(1, 1)).toBe("1 question · 1 saved view");
    expect(formatReportContentsCount(2, 3)).toBe("2 questions · 3 saved views");
  });
});

describe("formatSavedViewType", () => {
  it("falls back for persisted chart types outside the current metadata set", () => {
    expect(formatSavedViewType("barX")).toBe("Horizontal bar");
    expect(formatSavedViewType("legacy-pie")).toBe("Saved view");
  });
});

describe("reportQuestionLink", () => {
  it("keeps an existing question scoped to the report it was opened from", () => {
    expect(reportQuestionLink("question-1", "report-b")).toEqual({
      to: "/insights/question-1",
      search: { reportId: "report-b" },
    });
  });
});

import { describe, expect, it } from "vite-plus/test";
import {
  reportQuestionLink,
  reportSavedViewLink,
} from "./DashboardDetailContent";

describe("reportQuestionLink", () => {
  it("keeps an existing question scoped to the report it was opened from", () => {
    expect(reportQuestionLink("question-1", "report-b")).toEqual({
      to: "/insights/question-1",
      search: { reportId: "report-b" },
    });
  });
});

describe("reportSavedViewLink", () => {
  it("keeps a saved view scoped to the second report it was opened from", () => {
    const reportIds = ["report-a", "report-b"];

    expect(reportSavedViewLink("view-1", reportIds[1])).toEqual({
      to: "/visualizations/view-1",
      search: { reportId: "report-b" },
    });
  });
});

import { validateVisualizationSearch } from "@/routes/visualizations/$visualizationId";
import { describe, expect, it } from "vite-plus/test";
import { reportSavedViewLink } from "@/app/dashboards/[dashboardId]/_components/DashboardDetailContent";
import {
  visualizationDetailLink,
  visualizationSourceQuestionLink,
} from "@/components/visualizations/visualization-navigation";

describe("validateVisualizationSearch", () => {
  it("preserves a non-empty report id and rejects malformed values", () => {
    expect(validateVisualizationSearch({ reportId: "report-b" })).toEqual({
      reportId: "report-b",
    });
    expect(validateVisualizationSearch({ reportId: "  " })).toEqual({
      reportId: undefined,
    });
    expect(validateVisualizationSearch({ reportId: ["report-b"] })).toEqual({
      reportId: undefined,
    });
  });

  it("round trips from the second report through a saved view to its source question", () => {
    const reportIds = ["report-a", "report-b"];
    const savedViewLink = reportSavedViewLink("view-1", reportIds[1]);
    const { reportId } = validateVisualizationSearch(savedViewLink.search);

    expect(visualizationSourceQuestionLink("question-1", reportId)).toEqual({
      to: "/insights/question-1",
      search: { reportId: "report-b" },
    });
  });

  it("keeps the second report through a duplicate saved view and its source question", () => {
    const duplicateLink = visualizationDetailLink("view-copy", "report-b");
    const { reportId } = validateVisualizationSearch(duplicateLink.search);

    expect(duplicateLink).toEqual({
      to: "/visualizations/view-copy",
      search: { reportId: "report-b" },
    });
    expect(visualizationSourceQuestionLink("question-1", reportId)).toEqual({
      to: "/insights/question-1",
      search: { reportId: "report-b" },
    });
  });
});

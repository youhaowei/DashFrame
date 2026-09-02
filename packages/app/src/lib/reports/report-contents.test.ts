import type { Dashboard, Insight, Visualization } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import { resolveReportContents } from "./report-contents";

const report = {
  id: "report-1",
  name: "Revenue pulse",
  createdAt: 0,
  updatedAt: 0,
  items: [
    {
      id: "item-1",
      type: "visualization",
      visualizationId: "view-2",
      x: 0,
      y: 0,
      width: 6,
      height: 4,
    },
    {
      id: "item-2",
      type: "visualization",
      visualizationId: "view-1",
      x: 6,
      y: 0,
      width: 6,
      height: 4,
    },
    {
      id: "item-3",
      type: "visualization",
      visualizationId: "view-2",
      x: 0,
      y: 4,
      width: 6,
      height: 4,
    },
    {
      id: "item-missing",
      type: "visualization",
      visualizationId: "missing-view",
      x: 6,
      y: 4,
      width: 6,
      height: 4,
    },
  ],
} as Dashboard;

const visualizations = [
  { id: "view-1", name: "Trend", insightId: "question-1" },
  { id: "view-2", name: "Segments", insightId: "question-1" },
] as Visualization[];

const insights = [
  { id: "question-1", name: "Where is revenue growing?" },
] as Insight[];

describe("resolveReportContents", () => {
  it("deduplicates widgets and preserves their first report order", () => {
    const contents = resolveReportContents(report, visualizations, insights);

    expect(contents.savedViews.map((view) => view.id)).toEqual([
      "view-2",
      "view-1",
    ]);
    expect(contents.questionIds).toEqual(["question-1"]);
    expect(contents.questions.map((question) => question.id)).toEqual([
      "question-1",
    ]);
  });

  it("keeps a factual question count when the Insight row is unavailable", () => {
    const contents = resolveReportContents(report, visualizations, []);

    expect(contents.questionIds).toEqual(["question-1"]);
    expect(contents.questions).toEqual([]);
  });
});

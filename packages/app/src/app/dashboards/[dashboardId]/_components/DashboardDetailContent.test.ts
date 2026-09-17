import { describe, expect, it } from "vite-plus/test";
import { formatReportContentsCount } from "./DashboardDetailContent";

describe("formatReportContentsCount", () => {
  it("uses factual singular and plural labels for both nested artifact types", () => {
    expect(formatReportContentsCount(0, 0)).toBe("0 questions · 0 saved views");
    expect(formatReportContentsCount(1, 1)).toBe("1 question · 1 saved view");
    expect(formatReportContentsCount(2, 3)).toBe("2 questions · 3 saved views");
  });
});

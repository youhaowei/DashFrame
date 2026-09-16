import { describe, expect, it } from "vite-plus/test";
import {
  formatBrokenTilesLine,
  formatReportContentsCount,
} from "./DashboardDetailContent";

describe("formatReportContentsCount", () => {
  it("uses factual singular and plural labels for both nested artifact types", () => {
    expect(formatReportContentsCount(0, 0)).toBe("0 questions · 0 saved views");
    expect(formatReportContentsCount(1, 1)).toBe("1 question · 1 saved view");
    expect(formatReportContentsCount(2, 3)).toBe("2 questions · 3 saved views");
  });
});

describe("formatBrokenTilesLine", () => {
  it("says nothing unless a tile cannot be shown at all", () => {
    expect(formatBrokenTilesLine([], "reader")).toBeNull();
    expect(formatBrokenTilesLine([], "author")).toBeNull();
  });

  it("gives the reader the count and the author the names", () => {
    expect(formatBrokenTilesLine(["Revenue"], "reader")).toBe(
      "1 chart can't be shown right now",
    );
    expect(formatBrokenTilesLine(["Revenue", "Orders"], "author")).toBe(
      "2 charts can't be shown right now: Revenue, Orders",
    );
  });
});

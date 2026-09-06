import { describe, expect, it } from "vite-plus/test";
import { formatDashboardItemCount } from "./DashboardDetailContent";

describe("formatDashboardItemCount", () => {
  it("uses the singular label only for one dashboard item", () => {
    expect(formatDashboardItemCount(0)).toBe("0 items");
    expect(formatDashboardItemCount(1)).toBe("1 item");
    expect(formatDashboardItemCount(2)).toBe("2 items");
  });
});

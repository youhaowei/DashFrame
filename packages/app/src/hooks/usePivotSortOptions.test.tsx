import { act, renderHook } from "@testing-library/react";
import type { Insight } from "@dashframe/types";
import { describe, expect, it, vi } from "vite-plus/test";
import { usePivotSortOptions } from "./usePivotSortOptions";

const insight = {
  id: "report",
  name: "Sales",
  source: { sourceType: "dataTable", sourceId: "sales" },
  selectedFields: ["month", "channel"],
  metrics: [
    {
      id: "revenue",
      name: "Revenue",
      sourceTable: "sales",
      aggregation: "sum",
    },
  ],
  reporting: { pivotFields: ["channel"] },
  createdAt: 0,
} satisfies Insight;

function result(fetchData = vi.fn()) {
  return { isReady: true, totalCount: 2, fetchData };
}

describe("usePivotSortOptions", () => {
  it("explains an incompatible viewer dimension selection without loading rows", async () => {
    const fetchData = vi.fn();
    const { result: hook } = renderHook(() =>
      usePivotSortOptions(insight, result(fetchData), ["month"]),
    );

    await act(async () => Promise.resolve());

    expect(fetchData).not.toHaveBeenCalled();
    expect(hook.current).toEqual({
      options: [],
      error:
        "Reset the viewer dimension controls to choose a pivot cell to sort by.",
      retry: undefined,
    });
  });

  it("loads canonical rows when every saved pivot dimension remains selected", async () => {
    const fetchData = vi.fn().mockResolvedValue({
      rows: [
        { field_month: "2026-01", field_channel: "Web", metric_revenue: 10 },
        {
          field_month: "2026-01",
          field_channel: "Store",
          metric_revenue: 20,
        },
      ],
      totalCount: 2,
    });
    const { result: hook } = renderHook(() =>
      usePivotSortOptions(insight, result(fetchData), insight.selectedFields),
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    expect(fetchData).toHaveBeenCalledWith({ offset: 0, limit: 2 });
    expect(hook.current.error).toBeUndefined();
    expect(hook.current.retry).toEqual(expect.any(Function));
    expect(hook.current.options).toHaveLength(2);
  });
});

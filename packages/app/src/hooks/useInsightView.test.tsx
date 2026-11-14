import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { useInsightView } from "./useInsightView";

const pagination = vi.fn();
vi.mock("./useInsightPagination", () => ({
  useInsightPagination: (options: unknown) => pagination(options),
}));

const insight = {
  id: "insight-1",
  source: { sourceType: "dataTable", sourceId: "table-1" },
} as never;

describe("useInsightView", () => {
  it("is not ready without a frame handle so a stale chart cannot render", () => {
    pagination.mockReturnValue({
      dataFrameId: null,
      isReady: true,
      error: "Frame fetch failed",
    });

    const { result } = renderHook(() => useInsightView(insight));

    expect(result.current).toMatchObject({
      viewName: null,
      isReady: false,
      error: "Frame fetch failed",
    });
  });
});

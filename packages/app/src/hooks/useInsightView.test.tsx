import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { useInsightView } from "./useInsightView";

const pagination = vi.fn();
vi.mock("./useInsightPagination", () => ({
  useInsightPagination: (options: unknown) => pagination(options),
}));

const insight = {
  id: "insight-1",
  baseTableId: "table-1",
} as never;

describe("useInsightView", () => {
  it("exposes the ready server DataFrame UUID, not a client view", () => {
    pagination.mockReturnValue({
      dataFrameId: "018f1a50-7bde-7cde-8dc2-5e308fcec8b4",
      isReady: true,
      error: null,
    });

    const runtime = { limit: 25 };
    const { result } = renderHook(() => useInsightView(insight, { runtime }));

    expect(result.current).toMatchObject({
      viewName: "018f1a50-7bde-7cde-8dc2-5e308fcec8b4",
      isReady: true,
      error: null,
    });
    expect(pagination).toHaveBeenCalledWith(
      expect.objectContaining({
        showModelPreview: false,
        enabled: true,
        runtime,
      }),
    );
  });

  it("clears the handle on failure so a stale chart cannot render", () => {
    pagination.mockReturnValue({
      dataFrameId: null,
      isReady: false,
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

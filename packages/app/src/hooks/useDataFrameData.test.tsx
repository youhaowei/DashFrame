import { nativeQueryMock, hostQueryMock } from "@/test/native-query-fixture";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { queryDataFrame, mockFrames } = vi.hoisted(() => ({
  queryDataFrame: vi.fn(),
  mockFrames: vi.fn(),
}));

vi.mock("@/lib/data-access/data-frames", () => ({ queryDataFrame }));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(() => mockFrames()),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock(() => mockFrames()),
}));

import {
  useDataFrameData,
  useDataFrameDataByInsight,
} from "./useDataFrameData";

describe("useDataFrameData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrames.mockReturnValue({ data: [] });
  });

  it("reads a bounded server page and uses its schema", async () => {
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [{ id: "field-1", name: "Revenue", type: "number" }],
      rows: [{ "field-1": 42 }],
      totalCount: 1,
      page: { offset: 0, limit: 25, returned: 1 },
    });
    const { result } = renderHook(() =>
      useDataFrameData("frame-1", { limit: 25 }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(queryDataFrame).toHaveBeenCalledWith("frame-1", {
      offset: 0,
      limit: 25,
    });
    expect(result.current.data).toEqual({
      rows: [{ "field-1": 42 }],
      columns: [{ name: "Revenue", type: "number" }],
    });
  });

  it("does not treat a failed page as an empty successful result", async () => {
    queryDataFrame.mockResolvedValue({
      status: "failed",
      code: "FRAME_UNAVAILABLE",
      message: "Frame unavailable",
    });
    const { result } = renderHook(() => useDataFrameData("frame-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Frame unavailable");
  });

  it("discards a superseded response", async () => {
    let resolveFirst!: (value: unknown) => void;
    queryDataFrame.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    queryDataFrame.mockResolvedValueOnce({
      status: "ready",
      schema: [{ id: "b", name: "B", type: "string" }],
      rows: [{ b: "new" }],
      totalCount: 1,
      page: { offset: 0, limit: 100, returned: 1 },
    });
    const { result, rerender } = renderHook(({ id }) => useDataFrameData(id), {
      initialProps: { id: "frame-a" },
    });
    rerender({ id: "frame-b" });
    await waitFor(() =>
      expect(result.current.data?.rows).toEqual([{ b: "new" }]),
    );
    await act(async () =>
      resolveFirst({
        status: "ready",
        schema: [{ id: "a", name: "A", type: "string" }],
        rows: [{ a: "stale" }],
        totalCount: 1,
        page: { offset: 0, limit: 100, returned: 1 },
      }),
    );
    expect(result.current.data?.rows).toEqual([{ b: "new" }]);
  });

  it("uses the canonical current Insight generation when timestamps tie", async () => {
    mockFrames.mockReturnValue({
      data: [
        {
          id: "old-frame",
          insightId: "insight-1",
          createdAt: 100,
          lastRefreshedAt: 200,
        },
        {
          id: "current-frame",
          insightId: "insight-1",
          createdAt: 100,
          lastRefreshedAt: 200,
          currentInsightResult: true,
        },
      ],
    });
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 0,
      page: { offset: 0, limit: 100, returned: 0 },
    });

    renderHook(() => useDataFrameDataByInsight("insight-1"));

    await waitFor(() =>
      expect(queryDataFrame).toHaveBeenCalledWith("current-frame", {
        offset: 0,
        limit: 100,
      }),
    );
  });
});

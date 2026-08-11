import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDataFramePagination } from "./useDataFramePagination";

const { queryDataFrame } = vi.hoisted(() => ({ queryDataFrame: vi.fn() }));
vi.mock("@/lib/data-access/data-frames", () => ({ queryDataFrame }));

describe("useDataFramePagination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resets columns for an empty server result and bounds table reads", async () => {
    queryDataFrame
      .mockResolvedValueOnce({
        status: "ready",
        schema: [{ id: "field-a", name: "A", type: "string" }],
        rows: [],
        totalCount: 3,
        page: {},
      })
      .mockResolvedValueOnce({
        status: "ready",
        schema: [{ id: "field-b", name: "B", type: "number" }],
        rows: [],
        totalCount: 0,
        page: {},
      })
      .mockResolvedValueOnce({
        status: "ready",
        schema: [],
        rows: [{ b: 2 }],
        totalCount: 7,
        page: {},
      });
    const { result, rerender } = renderHook(
      ({ id }) => useDataFramePagination(id),
      {
        initialProps: { id: "frame-a" },
      },
    );
    await waitFor(() =>
      expect(result.current.columns).toEqual([{ name: "A", type: "string" }]),
    );
    rerender({ id: "frame-b" });
    await waitFor(() =>
      expect(result.current.columns).toEqual([{ name: "B", type: "number" }]),
    );
    await act(async () => {
      await expect(
        result.current.fetchData({
          offset: 5,
          limit: 900,
          sortColumn: "B",
          sortDirection: "desc",
        }),
      ).resolves.toEqual({ rows: [{ b: 2 }], totalCount: 7 });
    });
    expect(queryDataFrame).toHaveBeenLastCalledWith("frame-b", {
      offset: 5,
      limit: 500,
      sort: [{ fieldId: "field-b", direction: "desc" }],
    });
  });

  it("discards a page returned for the previous DataFrame generation", async () => {
    queryDataFrame.mockResolvedValueOnce({
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 1,
      page: {},
    });
    let resolvePage!: (value: unknown) => void;
    queryDataFrame.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePage = resolve)),
    );
    queryDataFrame.mockResolvedValueOnce({
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 2,
      page: {},
    });
    const { result, rerender } = renderHook(
      ({ id }) => useDataFramePagination(id),
      { initialProps: { id: "frame-a" } },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const pending = result.current.fetchData({ offset: 0, limit: 10 });
    rerender({ id: "frame-b" });
    await waitFor(() => expect(queryDataFrame).toHaveBeenCalledTimes(3));
    await act(async () =>
      resolvePage({ status: "ready", rows: [{ stale: true }], totalCount: 1 }),
    );
    await expect(pending).resolves.toEqual({ rows: [], totalCount: 0 });
  });
});

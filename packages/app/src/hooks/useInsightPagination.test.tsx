import type { Insight } from "@dashframe/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInsightPagination } from "./useInsightPagination";

const { queryDataFrame, client } = vi.hoisted(() => ({
  queryDataFrame: vi.fn(),
  client: { mutate: vi.fn() },
}));
vi.mock("@/lib/data-access/data-frames", () => ({ queryDataFrame }));
vi.mock("@/wystack/client", () => ({ getWyStackClient: () => client }));

const insight = {
  id: "insight-1",
  name: "Revenue",
  baseTableId: "table-1",
  selectedFields: ["10000000-0000-4000-8000-000000000001"],
  metrics: [],
  createdAt: 0,
} as Insight;

describe("useInsightPagination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs saved insights with declared runtime controls then queries the returned handle", async () => {
    client.mutate.mockResolvedValue({
      status: "ready",
      dataFrameId: "frame-1",
    });
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [
        {
          id: "field_10000000_0000_4000_8000_000000000001",
          name: "Revenue",
          type: "number",
        },
      ],
      rows: [],
      totalCount: 12,
      page: {},
    });
    const runtime = {
      limit: 5,
      sort: [{ fieldId: "field-1", direction: "desc" as const }],
    };
    const { result } = renderHook(() =>
      useInsightPagination({ insight, runtime }),
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(client.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ _path: "runInsight" }),
      {
        insightId: "insight-1",
        runtime,
      },
    );
    expect(queryDataFrame).toHaveBeenCalledWith("frame-1", {
      offset: 0,
      limit: 100,
    });
    expect(result.current.totalCount).toBe(5);
    expect(result.current.columns).toEqual([
      {
        name: "field_10000000_0000_4000_8000_000000000001",
        type: "number",
      },
    ]);
    expect(result.current.columnDisplayNames).toEqual({
      field_10000000_0000_4000_8000_000000000001: "Revenue",
    });
    expect(result.current.resolvedFields).toEqual([
      expect.objectContaining({
        id: "10000000-0000-4000-8000-000000000001",
        name: "Revenue",
      }),
    ]);
    await act(async () => {
      await expect(
        result.current.fetchData({ offset: 5, limit: 25 }),
      ).resolves.toEqual({ rows: [], totalCount: 5 });
    });
    expect(queryDataFrame).toHaveBeenCalledTimes(1);
  });

  it("uses fetchData only for ephemeral previews and exposes fetch failure", async () => {
    client.mutate.mockResolvedValue({
      status: "failed",
      message: "Connector offline",
    });
    const { result } = renderHook(() =>
      useInsightPagination({ insight, showModelPreview: true }),
    );
    await waitFor(() => expect(result.current.error).toBe("Connector offline"));
    expect(result.current.isReady).toBe(false);
    expect(result.current.columns).toEqual([]);
    expect(client.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ _path: "fetchData" }),
      {
        insight: {
          baseTableId: "table-1",
          selectedFields: ["10000000-0000-4000-8000-000000000001"],
          metrics: [],
          filters: undefined,
          sorts: undefined,
          joins: undefined,
        },
      },
    );
    expect(queryDataFrame).not.toHaveBeenCalled();
  });

  it("discards a stale materialization after the insight changes", async () => {
    let resolveA!: (value: unknown) => void;
    client.mutate.mockImplementationOnce(
      () => new Promise((resolve) => (resolveA = resolve)),
    );
    client.mutate.mockResolvedValueOnce({
      status: "ready",
      dataFrameId: "frame-b",
    });
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 2,
      page: {},
    });
    const insightB = { ...insight, id: "insight-2" };
    const { result, rerender } = renderHook(
      ({ value }) => useInsightPagination({ insight: value }),
      { initialProps: { value: insight } },
    );
    rerender({ value: insightB });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await act(async () =>
      resolveA({ status: "failed", message: "stale failure" }),
    );
    expect(result.current.error).toBeNull();
    expect(result.current.totalCount).toBe(2);
  });

  it("surfaces an initial page rejection without an unhandled promise", async () => {
    client.mutate.mockResolvedValue({
      status: "ready",
      dataFrameId: "frame-1",
    });
    queryDataFrame.mockRejectedValue(new Error("Frame disappeared"));

    const { result } = renderHook(() => useInsightPagination({ insight }));

    await waitFor(() => expect(result.current.error).toBe("Frame disappeared"));
    expect(result.current.isReady).toBe(false);
    expect(result.current.dataFrameId).toBeNull();
  });

  it("discards a page that resolves after the Insight generation changes", async () => {
    client.mutate.mockResolvedValue({
      status: "ready",
      dataFrameId: "frame-a",
    });
    queryDataFrame.mockResolvedValueOnce({
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 2,
      page: {},
    });
    let resolvePage!: (value: unknown) => void;
    queryDataFrame.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePage = resolve)),
    );
    const { result, rerender } = renderHook(
      ({ value, enabled }) => useInsightPagination({ insight: value, enabled }),
      { initialProps: { value: insight, enabled: true } },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const pending = result.current.fetchData({ offset: 0, limit: 10 });
    rerender({ value: insight, enabled: false });
    await act(async () =>
      resolvePage({ status: "ready", rows: [{ value: 1 }], totalCount: 2 }),
    );
    await expect(pending).resolves.toEqual({ rows: [], totalCount: 0 });
  });
});

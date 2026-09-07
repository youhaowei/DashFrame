import { nativeQueryMock, hostQueryMock } from "@/test/native-query-fixture";
import type { DataTable, Insight, UUID } from "@dashframe/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildInsightSourceRevision,
  resolveInsightResultFields,
  resolveInsightSourceDataTable,
  useInsightPagination,
} from "./useInsightPagination";

const { queryDataFrame, client, useQuery, runtime } = vi.hoisted(() => ({
  queryDataFrame: vi.fn(),
  client: { mutate: vi.fn() },
  useQuery: vi.fn(() => ({ data: [] })),
  runtime: { scope: {} as object },
}));
vi.mock("@/lib/data-access/data-frames", () => ({ queryDataFrame }));
vi.mock("@/data/runtime", () => ({
  getConvexClient: () => client,
  getRuntimeConfig: () => runtime.scope,
  useQuery: () => ({ data: [] }),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(useQuery),
}));
vi.mock("@/data/host", () => ({
  requestHost: (operation: string, args: unknown) =>
    client.mutate({ _path: operation }, args),
  useHostQuery: hostQueryMock(useQuery),
}));

const insight = {
  id: "insight-1",
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: "table-1" },
  selectedFields: ["10000000-0000-4000-8000-000000000001"],
  metrics: [],
  createdAt: 0,
} as Insight;

describe("useInsightPagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.scope = {};
  });

  it("stays idle while its insight is absent during a cold render", async () => {
    const { result } = renderHook(() =>
      useInsightPagination({ insight: undefined }),
    );

    await act(async () => undefined);
    expect(client.mutate).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      dataFrameId: null,
      isReady: false,
      resolvedFields: [],
    });
  });

  it("finishes the active materialization when StrictMode replays effects", async () => {
    client.mutate.mockResolvedValue({
      status: "ready",
      dataFrameId: "frame-strict",
    });
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [],
      rows: [{ value: 3 }],
      totalCount: 1,
      page: {},
    });
    const { result } = renderHook(() => useInsightPagination({ insight }), {
      wrapper: StrictMode,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(client.mutate).toHaveBeenCalledTimes(1);
    expect(queryDataFrame).toHaveBeenCalledTimes(1);
    expect(result.current.sampleRows).toEqual([{ value: 3 }]);
  });

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

  it("keeps a retained immutable frame readable after a saved refresh failure", async () => {
    client.mutate.mockResolvedValue({
      status: "failed",
      message: "Connector offline",
      lastSuccessful: {
        stale: true,
        dataFrameId: "frame-stale",
        fetchedAt: 123,
      },
    });
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [],
      rows: [{ country: "CA" }],
      totalCount: 1,
      page: {},
    });

    const { result } = renderHook(() => useInsightPagination({ insight }));

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(queryDataFrame).toHaveBeenCalledWith("frame-stale", {
      offset: 0,
      limit: 100,
    });
    expect(result.current).toMatchObject({
      dataFrameId: "frame-stale",
      isStale: true,
      fetchedAt: 123,
      error: null,
      staleReason: "Connector offline",
      sampleRows: [{ country: "CA" }],
    });
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

  it("rematerializes when a mounted source table receives a new frame", async () => {
    useQuery.mockReturnValue({
      data: [
        {
          id: "table-1",
          dataFrameId: "source-frame-1",
          fields: [],
        } as unknown as DataTable,
      ],
    });
    client.mutate
      .mockResolvedValueOnce({
        status: "ready",
        dataFrameId: "result-1",
        fetchedAt: 123,
        sourceGenerations: [
          {
            tableId: "table-1",
            dataFrameId: "source-frame-owned",
            lastFetchedAt: 123,
          },
        ],
      })
      .mockResolvedValueOnce({ status: "ready", dataFrameId: "result-2" });
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 1,
      page: {},
    });

    const { result, rerender } = renderHook(() =>
      useInsightPagination({ insight }),
    );
    await waitFor(() => expect(result.current.dataFrameId).toBe("result-1"));

    useQuery.mockReturnValue({
      data: [
        {
          id: "table-1",
          dataFrameId: "source-frame-2",
          lastFetchedAt: 123,
          refreshRevision: "external",
          fields: [],
        } as unknown as DataTable,
      ],
    });
    rerender();

    await waitFor(() => expect(result.current.dataFrameId).toBe("result-2"));
    expect(client.mutate).toHaveBeenCalledTimes(2);
  });

  it("does not retrigger when a remote fetch publishes its own source frame", async () => {
    let resolveFetch!: (value: unknown) => void;
    useQuery.mockReturnValue({
      data: [
        {
          id: "table-1",
          dataFrameId: "source-frame-1",
          fields: [],
        } as unknown as DataTable,
      ],
    });
    client.mutate.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 1,
      page: {},
    });
    const { result, rerender } = renderHook(() =>
      useInsightPagination({ insight }),
    );
    await waitFor(() => expect(client.mutate).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveFetch({
        status: "ready",
        dataFrameId: "result-1",
        fetchedAt: 123,
        sourceGenerations: [
          {
            tableId: "table-1",
            dataFrameId: "source-frame-2",
            lastFetchedAt: 123,
          },
        ],
      });
    });
    await waitFor(() => expect(result.current.dataFrameId).toBe("result-1"));

    useQuery.mockReturnValue({
      data: [
        {
          id: "table-1",
          dataFrameId: "source-frame-2",
          lastFetchedAt: 123,
          fields: [],
        } as unknown as DataTable,
      ],
    });
    rerender();
    await act(async () => Promise.resolve());
    expect(client.mutate).toHaveBeenCalledTimes(1);
  });

  it.each(["source-frame-1", "source-frame-2"])(
    "rematerializes when a manual refresh selects retained %s",
    async (retainedFrame) => {
      let tables = [
        {
          id: "table-1",
          dataFrameId: "source-frame-1",
          lastFetchedAt: 1,
          fields: [],
        } as unknown as DataTable,
      ];
      useQuery.mockImplementation(() => ({ data: tables }));
      let calls = 0;
      client.mutate.mockImplementation(async () =>
        ++calls === 1
          ? {
              status: "ready",
              dataFrameId: "result-1",
              fetchedAt: 2,
              sourceGenerations: [
                {
                  tableId: "table-1",
                  dataFrameId: "source-frame-2",
                  lastFetchedAt: 2,
                },
              ],
            }
          : { status: "ready", dataFrameId: "result-2", fetchedAt: 4 },
      );
      queryDataFrame.mockResolvedValue({
        status: "ready",
        schema: [],
        rows: [],
        totalCount: 1,
        page: {},
      });
      const { result, rerender } = renderHook(() =>
        useInsightPagination({ insight }),
      );
      await waitFor(() => expect(result.current.dataFrameId).toBe("result-1"));
      tables = [
        { ...tables[0]!, dataFrameId: "source-frame-2", lastFetchedAt: 2 },
      ];
      rerender();
      await act(async () => Promise.resolve());
      expect(client.mutate).toHaveBeenCalledTimes(1);
      tables = [
        {
          ...tables[0]!,
          dataFrameId: retainedFrame,
          lastFetchedAt: 3,
          refreshRevision: "manual-rollback",
        },
      ];
      rerender();
      await waitFor(() => expect(result.current.dataFrameId).toBe("result-2"));
      expect(client.mutate).toHaveBeenCalledTimes(2);
    },
  );

  it("settles sibling publications without hiding new consumers, changed requests, or manual refreshes", async () => {
    let tables = [
      {
        id: "table-1",
        dataFrameId: "source-frame-1",
        lastFetchedAt: 1,
        fields: [],
      } as unknown as DataTable,
    ];
    useQuery.mockImplementation((procedure) => ({
      data: procedure._path === "listInsights" ? [] : tables,
    }));
    let savedCalls = 0;
    let previewCalls = 0;
    client.mutate.mockImplementation(async (procedure) => {
      const preview = procedure._path === "fetchData";
      const call = preview ? ++previewCalls : ++savedCalls;
      const kind = preview ? "preview" : "saved";
      return {
        status: "ready",
        dataFrameId: `${kind}-result-${call}`,
        fetchedAt: call,
        sourceGenerations: [
          {
            tableId: "table-1",
            dataFrameId: `${kind}-source-${call}`,
            lastFetchedAt: call * 2,
          },
        ],
      };
    });
    queryDataFrame.mockImplementation(async (dataFrameId) => ({
      status: "ready",
      schema: [],
      rows: [{ dataFrameId }],
      totalCount: 1,
      page: {},
    }));

    const { result, rerender } = renderHook(
      ({ savedInsight }) => ({
        saved: useInsightPagination({ insight: savedInsight }),
        preview: useInsightPagination({
          insight,
          showModelPreview: true,
        }),
      }),
      { initialProps: { savedInsight: insight } },
    );
    await waitFor(() => {
      expect(result.current.saved.dataFrameId).toBe("saved-result-1");
      expect(result.current.preview.dataFrameId).toBe("preview-result-1");
    });

    // The preview's automatic source publication is visible to the saved
    // consumer, but must not start an alternating refresh cycle.
    tables = [
      {
        ...tables[0]!,
        dataFrameId: "preview-source-1",
        lastFetchedAt: 2,
      },
    ];
    rerender({ savedInsight: insight });
    await act(async () => Promise.resolve());
    expect({ savedCalls, previewCalls }).toEqual({
      savedCalls: 1,
      previewCalls: 1,
    });

    // A request change is independent of source publication suppression.
    const changedInsight = {
      ...insight,
      selectedFields: ["20000000-0000-4000-8000-000000000002"],
    } as Insight;
    rerender({ savedInsight: changedInsight });
    await waitFor(() =>
      expect(result.current.saved.dataFrameId).toBe("saved-result-2"),
    );
    expect({ savedCalls, previewCalls }).toEqual({
      savedCalls: 2,
      previewCalls: 1,
    });

    // A manual refresh is not recorded by this hook, so both consumers must
    // update once. Their resulting automatic publications must then settle.
    tables = [
      {
        ...tables[0]!,
        dataFrameId: "manual-source",
        refreshRevision: "manual",
        lastFetchedAt: 3,
      },
    ];
    rerender({ savedInsight: changedInsight });
    await waitFor(() => {
      expect(result.current.saved.dataFrameId).toBe("saved-result-3");
      expect(result.current.preview.dataFrameId).toBe("preview-result-2");
    });
    expect({ savedCalls, previewCalls }).toEqual({
      savedCalls: 3,
      previewCalls: 2,
    });
    tables = [
      {
        ...tables[0]!,
        dataFrameId: "preview-source-2",
        lastFetchedAt: 4,
      },
    ];
    rerender({ savedInsight: changedInsight });
    await act(async () => Promise.resolve());
    expect({ savedCalls, previewCalls }).toEqual({
      savedCalls: 3,
      previewCalls: 2,
    });

    // A consumer mounted after that publication has no readable result yet,
    // so it still performs its initial materialization.
    const newcomer = renderHook(() =>
      useInsightPagination({ insight: changedInsight }),
    );
    await waitFor(() =>
      expect(newcomer.result.current.dataFrameId).toBe("saved-result-4"),
    );
    expect(savedCalls).toBe(4);
    newcomer.unmount();
  });

  it("preserves a manual invalidation while older sibling publications finish", async () => {
    let tables = [
      {
        id: "table-1",
        dataFrameId: "source-initial",
        lastFetchedAt: 1,
        fields: [],
      } as unknown as DataTable,
    ];
    useQuery.mockImplementation((procedure) => ({
      data: procedure._path === "listInsights" ? [] : tables,
    }));
    let phase: "initial" | "old-flight" | "after-manual" = "initial";
    let savedCalls = 0;
    let previewCalls = 0;
    let resolveOldSaved!: (value: unknown) => void;
    let resolveOldPreview!: (value: unknown) => void;
    let resolveOldSavedPage!: (value: unknown) => void;
    let resolveOldPreviewPage!: (value: unknown) => void;
    client.mutate.mockImplementation((procedure) => {
      const preview = procedure._path === "fetchData";
      const call = preview ? ++previewCalls : ++savedCalls;
      const kind = preview ? "preview" : "saved";
      if (phase === "old-flight")
        return new Promise((resolve) => {
          if (preview) resolveOldPreview = resolve;
          else resolveOldSaved = resolve;
        });
      return Promise.resolve({
        status: "ready",
        dataFrameId: `${phase}-${kind}-result-${call}`,
        sourceGenerations: [
          {
            tableId: "table-1",
            dataFrameId: `${phase}-${kind}-source-${call}`,
            lastFetchedAt: phase === "initial" ? 1 : 6,
          },
        ],
      });
    });
    const readyPage = {
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 1,
      page: {},
    };
    queryDataFrame.mockImplementation((dataFrameId) => {
      if (dataFrameId === "old-saved-result")
        return new Promise((resolve) => (resolveOldSavedPage = resolve));
      if (dataFrameId === "old-preview-result")
        return new Promise((resolve) => (resolveOldPreviewPage = resolve));
      return Promise.resolve(readyPage);
    });

    const { result, rerender } = renderHook(() => ({
      saved: useInsightPagination({ insight }),
      preview: useInsightPagination({ insight, showModelPreview: true }),
    }));
    await waitFor(() => {
      expect(result.current.saved.isReady).toBe(true);
      expect(result.current.preview.isReady).toBe(true);
    });

    phase = "old-flight";
    tables = [
      {
        ...tables[0]!,
        dataFrameId: "old-trigger",
        lastFetchedAt: 2,
        refreshRevision: "old-trigger",
      },
    ];
    rerender();
    await waitFor(() =>
      expect({ savedCalls, previewCalls }).toEqual({
        savedCalls: 2,
        previewCalls: 2,
      }),
    );

    // The external/manual generation arrives while both older requests are
    // active. Later automatic source publications must not erase that intent.
    tables = [
      {
        ...tables[0]!,
        dataFrameId: "manual-1",
        lastFetchedAt: 3,
        refreshRevision: "manual-1",
      },
    ];
    rerender();
    await act(async () => {
      resolveOldSaved({
        status: "ready",
        dataFrameId: "old-saved-result",
        sourceGenerations: [
          {
            tableId: "table-1",
            dataFrameId: "old-saved-source",
            lastFetchedAt: 4,
          },
        ],
      });
    });
    await waitFor(() =>
      expect(queryDataFrame).toHaveBeenCalledWith("old-saved-result", {
        offset: 0,
        limit: 100,
      }),
    );
    tables = [
      { ...tables[0]!, dataFrameId: "old-saved-source", lastFetchedAt: 4 },
    ];
    rerender();
    phase = "after-manual";
    await act(async () => resolveOldSavedPage(readyPage));
    await waitFor(() => expect(savedCalls).toBe(3));

    await act(async () => {
      resolveOldPreview({
        status: "ready",
        dataFrameId: "old-preview-result",
        sourceGenerations: [
          {
            tableId: "table-1",
            dataFrameId: "old-preview-source",
            lastFetchedAt: 5,
          },
        ],
      });
    });
    await waitFor(() =>
      expect(queryDataFrame).toHaveBeenCalledWith("old-preview-result", {
        offset: 0,
        limit: 100,
      }),
    );
    tables = [
      { ...tables[0]!, dataFrameId: "old-preview-source", lastFetchedAt: 5 },
    ];
    rerender();
    await act(async () => resolveOldPreviewPage(readyPage));
    await waitFor(() => expect(previewCalls).toBe(3));

    tables = [
      {
        ...tables[0]!,
        dataFrameId: "after-manual-preview-source-3",
        lastFetchedAt: 6,
      },
    ];
    rerender();
    await act(async () => Promise.resolve());
    expect({ savedCalls, previewCalls }).toEqual({
      savedCalls: 3,
      previewCalls: 3,
    });

    // A later unrelated manual generation still invalidates both consumers.
    tables = [
      {
        ...tables[0]!,
        dataFrameId: "manual-2",
        lastFetchedAt: 7,
        refreshRevision: "manual-2",
      },
    ];
    rerender();
    await waitFor(() =>
      expect({ savedCalls, previewCalls }).toEqual({
        savedCalls: 4,
        previewCalls: 4,
      }),
    );
  });

  it("suppresses a composed upstream publication but not another frame with the same timestamp", async () => {
    const upstream = {
      ...insight,
      id: "insight-upstream",
      source: { sourceType: "dataTable", sourceId: "table-1" },
    } as Insight;
    const composed = {
      ...insight,
      id: "insight-composed",
      source: { sourceType: "insight", sourceId: upstream.id },
    } as Insight;
    let tables = [
      {
        id: "table-1",
        dataFrameId: "source-frame-1",
        fields: [],
      } as unknown as DataTable,
    ];
    useQuery.mockImplementation((procedure) => ({
      data: procedure._path === "listInsights" ? [upstream] : tables,
    }));
    client.mutate.mockResolvedValue({
      status: "ready",
      dataFrameId: "result-1",
      fetchedAt: 123,
      sourceGenerations: [
        {
          tableId: "table-1",
          dataFrameId: "source-frame-2",
          lastFetchedAt: 123,
        },
      ],
    });
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 1,
      page: {},
    });
    const { result, rerender } = renderHook(() =>
      useInsightPagination({ insight: composed }),
    );
    await waitFor(() => expect(result.current.dataFrameId).toBe("result-1"));

    tables = [
      {
        ...tables[0]!,
        dataFrameId: "source-frame-2",
        lastFetchedAt: 123,
      },
    ];
    rerender();
    await act(async () => Promise.resolve());
    expect(client.mutate).toHaveBeenCalledTimes(1);

    tables = [
      {
        ...tables[0]!,
        dataFrameId: "external-frame",
        refreshRevision: "external",
        lastFetchedAt: 123,
      },
    ];
    rerender();
    await waitFor(() => expect(client.mutate).toHaveBeenCalledTimes(2));
  });

  it("settles a composed outer failure after its upstream publication", async () => {
    const upstream = {
      ...insight,
      id: "insight-upstream-failure",
      source: { sourceType: "dataTable", sourceId: "table-1" },
    } as Insight;
    const composed = {
      ...insight,
      id: "insight-composed-failure",
      source: { sourceType: "insight", sourceId: upstream.id },
    } as Insight;
    let tables = [
      {
        id: "table-1",
        dataFrameId: "source-frame-1",
        fields: [],
      } as unknown as DataTable,
    ];
    useQuery.mockImplementation((procedure) => ({
      data: procedure._path === "listInsights" ? [upstream] : tables,
    }));
    client.mutate.mockResolvedValue({
      status: "failed",
      code: "FETCH_COMPILE_FAILED",
      message: "Live data could not be fetched.",
      retryable: false,
      diagnosticId: "outer-failure",
      sourceGenerations: [
        {
          tableId: "table-1",
          dataFrameId: "intermediate-source",
          lastFetchedAt: 122,
        },
        {
          tableId: "table-1",
          dataFrameId: "source-frame-2",
          lastFetchedAt: 123,
        },
      ],
    });
    const { result, rerender } = renderHook(() =>
      useInsightPagination({ insight: composed }),
    );
    await waitFor(() =>
      expect(result.current.error).toBe("Live data could not be fetched."),
    );

    // Distinct subscription deliveries may both arrive after the failed HTTP
    // response. Keep this operation's proof until an external revision arrives.
    tables = [
      { ...tables[0]!, dataFrameId: "intermediate-source", lastFetchedAt: 122 },
    ];
    rerender();
    await act(async () => undefined);
    expect(client.mutate).toHaveBeenCalledTimes(1);

    tables = [
      {
        ...tables[0]!,
        dataFrameId: "source-frame-2",
        lastFetchedAt: 123,
      },
    ];
    rerender();
    await act(async () => Promise.resolve());
    expect(client.mutate).toHaveBeenCalledTimes(1);

    tables = [
      {
        ...tables[0]!,
        dataFrameId: "external-frame",
        refreshRevision: "external",
        lastFetchedAt: 123,
      },
    ];
    rerender();
    await waitFor(() => expect(client.mutate).toHaveBeenCalledTimes(2));
  });
  it.each(["reject", "failed", "page-failed"])(
    "retries an unreadable %s consumer after a sibling publication",
    async (failure) => {
      let tables = [
        {
          id: "table-1",
          fields: [],
          dataFrameId: "a",
          lastFetchedAt: 1,
          refreshRevision: "initial",
        } as unknown as DataTable,
      ];
      useQuery.mockImplementation((procedure) => ({
        data: procedure._path === "listInsights" ? [] : tables,
      }));
      let settle!: (value: unknown) => void;
      let reject!: (cause: Error) => void;
      let savedCalls = 0;
      client.mutate.mockImplementation((procedure) => {
        if (procedure._path === "fetchData")
          return Promise.resolve({
            status: "ready",
            dataFrameId: "sibling",
            sourceGenerations: [
              { tableId: "table-1", dataFrameId: "b", lastFetchedAt: 2 },
            ],
          });
        if (++savedCalls === 1)
          return new Promise((resolve, fail) => {
            settle = resolve;
            reject = fail;
          });
        return Promise.resolve({ status: "ready", dataFrameId: "recovered" });
      });
      queryDataFrame.mockImplementation(async (frame) =>
        frame === "unreadable"
          ? { status: "failed", message: "frame unavailable" }
          : { status: "ready", schema: [], rows: [], totalCount: 1, page: {} },
      );
      const { result, rerender } = renderHook(() => ({
        saved: useInsightPagination({ insight }),
        sibling: useInsightPagination({ insight, showModelPreview: true }),
      }));
      await waitFor(() => expect(result.current.sibling.isReady).toBe(true));
      tables = [{ ...tables[0]!, dataFrameId: "b", lastFetchedAt: 2 }];
      rerender();
      await act(async () => {
        if (failure === "reject") reject(new Error("connection lost"));
        else
          settle(
            failure === "failed"
              ? { status: "failed", message: "no result", retryable: true }
              : { status: "ready", dataFrameId: "unreadable" },
          );
      });
      await waitFor(() =>
        expect(result.current.saved.dataFrameId).toBe("recovered"),
      );
      expect(savedCalls).toBe(2);
    },
  );

  it("suppresses subscription-first publications in independent consumers while preserving manual intent", async () => {
    let tables = [
      {
        id: "table-1",
        fields: [],
        dataFrameId: "a",
        lastFetchedAt: 1,
        refreshRevision: "initial",
      } as unknown as DataTable,
    ];
    useQuery.mockImplementation((procedure) => ({
      data: procedure._path === "listInsights" ? [] : tables,
    }));
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [],
      rows: [],
      totalCount: 1,
      page: {},
    });
    let settlePublisher!: (value: unknown) => void;
    let calls = 0;
    client.mutate.mockImplementation(() =>
      ++calls === 2
        ? new Promise((resolve) => {
            settlePublisher = resolve;
          })
        : Promise.resolve({ status: "ready", dataFrameId: `result-${calls}` }),
    );
    const first = renderHook(() => useInsightPagination({ insight }));
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    runtime.scope = {};
    const publisher = renderHook(() => useInsightPagination({ insight }));
    await waitFor(() => expect(calls).toBe(2));
    // Both intermediate publications precede the HTTP response, as with an
    // upstream Insight and outer join materializing the same table.
    for (const [frame, timestamp] of [
      ["b", 2],
      ["c", 3],
    ] as const) {
      tables = [
        { ...tables[0]!, dataFrameId: frame, lastFetchedAt: timestamp },
      ];
      first.rerender();
      publisher.rerender();
      await act(async () => undefined);
      expect(calls).toBe(2);
    }
    await act(async () =>
      settlePublisher({
        status: "ready",
        dataFrameId: "publisher-result",
        sourceGenerations: [
          { tableId: "table-1", dataFrameId: "b", lastFetchedAt: 2 },
          { tableId: "table-1", dataFrameId: "c", lastFetchedAt: 3 },
        ],
      }),
    );
    await waitFor(() => expect(publisher.result.current.isReady).toBe(true));
    expect(calls).toBe(2);
    // A manual epoch survives even when its frame was overwritten before the
    // subscription was delivered to either renderer.
    tables = [
      {
        ...tables[0]!,
        dataFrameId: "auto-after-manual",
        lastFetchedAt: 5,
        refreshRevision: "manual",
      },
    ];
    first.rerender();
    publisher.rerender();
    await waitFor(() => expect(calls).toBe(4));
    first.unmount();
    publisher.unmount();
  });
});

describe("buildInsightSourceRevision", () => {
  it("changes for base and joined source replacements but ignores unrelated frames", () => {
    const joinedTableId = "table-2" as UUID;
    const withJoin = {
      ...insight,
      joins: [
        {
          type: "left" as const,
          rightTableId: joinedTableId,
          leftKey: "account_id",
          rightKey: "id",
        },
      ],
    };
    const tables = [
      { id: "table-1", dataFrameId: "frame-base-1" },
      { id: joinedTableId, dataFrameId: "frame-join-1" },
      { id: "table-unrelated", dataFrameId: "frame-other-1" },
    ] as DataTable[];
    const initial = buildInsightSourceRevision(withJoin, tables);

    expect(
      buildInsightSourceRevision(withJoin, [
        ...tables.slice(0, 2),
        { ...tables[2]!, dataFrameId: "frame-other-2" as UUID },
      ]),
    ).toBe(initial);
    expect(
      buildInsightSourceRevision(withJoin, [
        { ...tables[0]!, dataFrameId: "frame-base-2" as UUID },
        ...tables.slice(1),
      ]),
    ).not.toBe(initial);
    expect(
      buildInsightSourceRevision(withJoin, [
        tables[0]!,
        { ...tables[1]!, lastFetchedAt: 2 },
        tables[2]!,
      ]),
    ).not.toBe(initial);
  });

  it("tracks transitive Insight definitions and upstream frame generations", () => {
    const baseTable = {
      id: "table-base",
      dataFrameId: "frame-1",
    } as DataTable;
    const upstream = {
      ...insight,
      id: "insight-upstream",
      source: { sourceType: "dataTable", sourceId: baseTable.id },
    } as Insight;
    const derived = {
      ...insight,
      id: "insight-derived",
      source: { sourceType: "insight", sourceId: upstream.id },
    } as Insight;
    const initial = buildInsightSourceRevision(
      derived,
      [baseTable],
      [upstream],
    );

    expect(
      buildInsightSourceRevision(
        derived,
        [baseTable],
        [{ ...upstream, selectedFields: ["changed-field" as UUID] }],
      ),
    ).not.toBe(initial);
    expect(
      buildInsightSourceRevision(
        derived,
        [{ ...baseTable, dataFrameId: "frame-2" as UUID }],
        [upstream],
      ),
    ).not.toBe(initial);
  });

  it("fails closed deterministically for composition cycles", () => {
    const a = {
      ...insight,
      id: "insight-a",
      source: { sourceType: "insight", sourceId: "insight-b" },
    } as Insight;
    const b = {
      ...insight,
      id: "insight-b",
      source: { sourceType: "insight", sourceId: "insight-a" },
    } as Insight;

    expect(buildInsightSourceRevision(a, [], [a, b])).toContain(
      "cycle:insight-a",
    );
  });

  it("caps malformed composition depth deterministically", () => {
    const chain = Array.from({ length: 18 }, (_, index) => ({
      ...insight,
      id: `insight-${index}`,
      source: {
        sourceType: "insight" as const,
        sourceId: `insight-${index + 1}`,
      },
    })) as Insight[];

    expect(buildInsightSourceRevision(chain[0]!, [], chain)).toContain(
      "depth:insight-16",
    );
  });
});

describe("resolveInsightResultFields", () => {
  it("resolves the root DataTable for a composed Insight", () => {
    const table = { id: "table-root", fields: [] } as DataTable;
    const upstream = {
      ...insight,
      id: "insight-upstream",
      source: { sourceType: "dataTable", sourceId: table.id },
    } as Insight;
    const derived = {
      ...insight,
      id: "insight-derived",
      source: { sourceType: "insight", sourceId: upstream.id },
    } as Insight;

    expect(
      resolveInsightSourceDataTable(derived, [table], [derived, upstream]),
    ).toBe(table);
  });

  it("preserves repeat-join source identity and gives each instance a distinct left-key label", () => {
    const baseId = "10000000-0000-4000-8000-000000000010" as UUID;
    const usersId = "10000000-0000-4000-8000-000000000020" as UUID;
    const fieldId = "10000000-0000-4000-8000-000000000030" as UUID;
    const tables = [
      {
        id: baseId,
        dataSourceId: "10000000-0000-4000-8000-000000000040" as UUID,
        name: "orders",
        table: "orders",
        dataFrameId: "10000000-0000-4000-8000-000000000013" as UUID,
        fields: [
          {
            id: "10000000-0000-4000-8000-000000000011" as UUID,
            tableId: baseId,
            name: "Created By",
            columnName: "created_by",
            type: "string",
          },
          {
            id: "10000000-0000-4000-8000-000000000012" as UUID,
            tableId: baseId,
            name: "Approved By",
            columnName: "approved_by",
            type: "string",
          },
        ],
        metrics: [],
        createdAt: 0,
      },
      {
        id: usersId,
        dataSourceId: "10000000-0000-4000-8000-000000000040" as UUID,
        name: "users",
        table: "users",
        dataFrameId: "10000000-0000-4000-8000-000000000023" as UUID,
        fields: [
          {
            id: "10000000-0000-4000-8000-000000000021" as UUID,
            tableId: usersId,
            name: "User ID",
            columnName: "id",
            type: "string",
          },
          {
            id: fieldId,
            tableId: usersId,
            name: "User Name",
            columnName: "name",
            type: "string",
          },
        ],
        metrics: [],
        createdAt: 0,
      },
    ] satisfies DataTable[];
    const repeatedInsight = {
      ...insight,
      source: { sourceType: "dataTable" as const, sourceId: baseId },
      joins: [
        {
          type: "left" as const,
          rightTableId: usersId,
          leftKey: "missing_key",
          rightKey: "id",
        },
        {
          type: "left" as const,
          rightTableId: usersId,
          leftKey: "created_by",
          rightKey: "id",
        },
        {
          type: "left" as const,
          rightTableId: usersId,
          leftKey: "approved_by",
          rightKey: "id",
        },
      ],
    };
    const alias = `field_${fieldId.replaceAll("-", "_")}` as UUID;
    const aliasJ1 = `${alias}_j1` as UUID;
    const resolved = resolveInsightResultFields(
      [
        { id: alias, name: "User Name", type: "string" },
        { id: aliasJ1, name: "User Name", type: "string" },
      ],
      repeatedInsight,
      tables,
    );

    expect(resolved.displayNames).toEqual({
      [alias]: "User Name (created_by)",
      [aliasJ1]: "User Name (approved_by)",
    });
    expect(
      resolved.fields.map(({ id, tableId, columnName }) => ({
        id,
        tableId,
        columnName,
      })),
    ).toEqual([
      { id: fieldId, tableId: usersId, columnName: alias },
      { id: `${fieldId}_j1`, tableId: usersId, columnName: aliasJ1 },
    ]);
  });
});

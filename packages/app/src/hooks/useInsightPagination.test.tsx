import { api } from "@/wystack/api";
import type { DataTable, Insight, UUID } from "@dashframe/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildInsightSourceRevision,
  resolveInsightResultFields,
  useInsightPagination,
} from "./useInsightPagination";

const { queryDataFrame, client, useQuery } = vi.hoisted(() => ({
  queryDataFrame: vi.fn(),
  client: { mutate: vi.fn() },
  useQuery: vi.fn(() => ({ data: [] })),
}));
vi.mock("@/lib/data-access/data-frames", () => ({ queryDataFrame }));
vi.mock("@/wystack/client", () => ({
  getWyStackClient: () => client,
  useQuery: () => ({ data: [] }),
}));
vi.mock("@wystack/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wystack/client")>()),
  useQuery,
}));

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
          { tableId: "table-1", dataFrameId: "source-frame-owned" },
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
          { tableId: "table-1", dataFrameId: "source-frame-2" },
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

  it("suppresses a composed upstream publication but not another frame with the same timestamp", async () => {
    const upstream = {
      ...insight,
      id: "insight-upstream",
      baseTableId: "table-1",
      source: { sourceType: "dataTable", sourceId: "table-1" },
    } as Insight;
    const composed = {
      ...insight,
      id: "insight-composed",
      baseTableId: upstream.id,
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
      data: procedure === api.listInsights ? [upstream] : tables,
    }));
    client.mutate.mockResolvedValue({
      status: "ready",
      dataFrameId: "result-1",
      fetchedAt: 123,
      sourceGenerations: [
        { tableId: "table-1", dataFrameId: "source-frame-2" },
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
      baseTableId: "table-1",
      source: { sourceType: "dataTable", sourceId: "table-1" },
    } as Insight;
    const composed = {
      ...insight,
      id: "insight-composed-failure",
      baseTableId: upstream.id,
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
      data: procedure === api.listInsights ? [upstream] : tables,
    }));
    client.mutate.mockResolvedValue({
      status: "failed",
      code: "FETCH_COMPILE_FAILED",
      message: "Live data could not be fetched.",
      retryable: false,
      diagnosticId: "outer-failure",
      sourceGenerations: [
        { tableId: "table-1", dataFrameId: "source-frame-2" },
      ],
    });
    const { result, rerender } = renderHook(() =>
      useInsightPagination({ insight: composed }),
    );
    await waitFor(() =>
      expect(result.current.error).toBe("Live data could not be fetched."),
    );

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
      { ...tables[0]!, dataFrameId: "external-frame", lastFetchedAt: 123 },
    ];
    rerender();
    await waitFor(() => expect(client.mutate).toHaveBeenCalledTimes(2));
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
      baseTableId: baseTable.id,
      source: { sourceType: "dataTable", sourceId: baseTable.id },
    } as Insight;
    const derived = {
      ...insight,
      id: "insight-derived",
      baseTableId: upstream.id,
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
      baseTableId: "insight-b",
      source: { sourceType: "insight", sourceId: "insight-b" },
    } as Insight;
    const b = {
      ...insight,
      id: "insight-b",
      baseTableId: "insight-a",
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
      baseTableId: `insight-${index + 1}`,
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
      baseTableId: baseId,
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

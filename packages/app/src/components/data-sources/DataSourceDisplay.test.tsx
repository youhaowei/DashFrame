import type { DataSource, DataTable, UUID } from "@dashframe/types";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockMutate, mockQueryDataFrame, queryData } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockQueryDataFrame: vi.fn(),
  queryData: { sources: [] as DataSource[], tables: [] as DataTable[] },
}));

vi.mock("@/lib/connectors/registry", () => ({
  getConnectorById: () => ({ sourceType: "remote-api" }),
  useRegistryVersion: () => undefined,
}));
vi.mock("@/wystack/client", () => ({
  getWyStackClient: () => ({ mutate: mockMutate }),
}));
vi.mock("@/lib/data-access/data-frames", () => ({
  queryDataFrame: mockQueryDataFrame,
}));
vi.mock("@wystack/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wystack/client")>()),
  useQuery: (ref: { _path: string }) => {
    if (ref._path === "listDataSources") return { data: queryData.sources };
    if (ref._path === "listDataTables") return { data: queryData.tables };
    return { data: [] };
  },
}));
vi.mock("@dashframe/ui", () => ({
  VirtualTable: ({ rows }: { rows: Record<string, unknown>[] }) => (
    <div>{rows.length} preview rows</div>
  ),
}));

import { DataSourceDisplay } from "./DataSourceDisplay";

const SOURCE_ID = "source-1" as UUID;
const TABLE_ID = "table-1" as UUID;
const TABLE_B_ID = "table-2" as UUID;

describe("DataSourceDisplay remote preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData.sources = [
      { id: SOURCE_ID, name: "CRM", type: "notion", config: {}, createdAt: 0 },
    ];
    queryData.tables = [
      {
        id: TABLE_ID,
        dataSourceId: SOURCE_ID,
        name: "Leads",
        table: "resource-1",
        fields: [],
        metrics: [],
        createdAt: 0,
      },
    ];
  });

  it("uses a narrow typed definition and pages a ready server handle", async () => {
    mockMutate.mockResolvedValue({
      status: "ready",
      dataFrameId: "frame-1",
      schema: [],
      rowCount: 1,
      definitionFingerprint: "fp",
      provenance: { connectorKind: "notion", bindingVersion: "1" },
      fetchedAt: 0,
    });
    mockQueryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [],
      rows: [{ name: "Ada" }],
      totalCount: 1,
      page: { offset: 0, limit: 100, returned: 1 },
    });
    render(<DataSourceDisplay dataSourceId={SOURCE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch data" }));
    await waitFor(() =>
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ _path: "fetchData" }),
        { insight: { baseTableId: TABLE_ID, selectedFields: [], metrics: [] } },
      ),
    );
    expect(await screen.findByText("1 preview rows")).toBeTruthy();
    expect(mockQueryDataFrame).toHaveBeenCalledWith("frame-1", {
      offset: 0,
      limit: 100,
    });
  });

  it("renders a failed metadata handle without a review gate", async () => {
    mockMutate.mockResolvedValue({
      status: "failed",
      code: "FETCH_SOURCE_FAILED",
      message: "Connection expired",
      retryable: true,
      diagnosticId: "diagnostic-1",
    });
    render(<DataSourceDisplay dataSourceId={SOURCE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch data" }));
    expect(await screen.findByText("Connection expired")).toBeTruthy();
    expect(screen.getByText("Fetch failed")).toBeTruthy();
    expect(screen.queryByText(/review column|approved fields/i)).toBeNull();
  });

  it("discards table A when its fetch completes after table B is selected", async () => {
    queryData.tables.push({
      id: TABLE_B_ID,
      dataSourceId: SOURCE_ID,
      name: "Accounts",
      table: "resource-2",
      fields: [],
      metrics: [],
      createdAt: 0,
    });
    let resolveTableA!: (value: unknown) => void;
    mockMutate.mockImplementationOnce(
      () => new Promise((resolve) => (resolveTableA = resolve)),
    );
    render(<DataSourceDisplay dataSourceId={SOURCE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Fetch data" }));
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    await act(async () => {
      resolveTableA({
        status: "ready",
        dataFrameId: "frame-a",
        schema: [],
        rowCount: 1,
        definitionFingerprint: "fp-a",
        provenance: { connectorKind: "notion", bindingVersion: "1" },
        fetchedAt: 0,
      });
    });

    expect(screen.getAllByText("Accounts")).toHaveLength(2);
    expect(screen.getByText("Fetch data to preview this table.")).toBeTruthy();
    expect(mockQueryDataFrame).not.toHaveBeenCalledWith(
      "frame-a",
      expect.anything(),
    );
  });
});

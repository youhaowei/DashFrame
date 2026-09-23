import {
  nativeQueryMock,
  nativeMutationMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
/**
 * DataSourcePageContent — the data source workbench.
 *
 * - Loading contract: a pending subscription never reads as "not found".
 * - Tabs: the source's tables fill the top bar; the open tab follows the URL
 *   and falls back to the first table; an empty source registers none.
 * - Panes: the left pane holds the source's configuration; the right pane
 *   exists only while a column is selected, and edits that column.
 * - Centre: the preview grid and its states, the Columns list, "Find column",
 *   and the empty/broken states of a source with no tables.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

// ── Mock helpers ──────────────────────────────────────────────────────────────

const {
  mockUseDataSources,
  mockUseDataTables,
  mockUseDataFrames,
  mockUseDataFrameData,
  mockReloadPreview,
  mockCommitBatch,
  mockToastError,
  mockRefreshTable,
  mockListGa4Properties,
  mockListPostgresTables,
  mockPrepareRemoteDataTable,
  mockInitialFetch,
  mockCreateInsightFromTable,
  mockNavigate,
} = vi.hoisted(() => ({
  mockUseDataSources: vi.fn(),
  mockUseDataTables: vi.fn(),
  mockUseDataFrames: vi.fn(),
  mockUseDataFrameData: vi.fn(),
  mockReloadPreview: vi.fn(),
  mockCommitBatch: vi.fn(),
  mockToastError: vi.fn(),
  mockRefreshTable: vi.fn(),
  mockListGa4Properties: vi.fn(),
  mockListPostgresTables: vi.fn(),
  mockPrepareRemoteDataTable: vi.fn(),
  mockInitialFetch: vi.fn(),
  mockCreateInsightFromTable: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (ref._path === "listDataSources") return mockUseDataSources();
    if (ref._path === "listDataTables") return mockUseDataTables();
    if (ref._path === "listDataFrames") return mockUseDataFrames();
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
  useMutation: nativeMutationMock((ref: { _path: string }) => {
    if (ref._path === "commitBatch") return { mutateAsync: mockCommitBatch };
    throw new Error(`Unexpected mutation: ${ref._path}`);
  }),
}));

vi.mock("@/data/host", () => ({
  useHostMutation: hostMutationMock((ref: { _path: string }) => {
    const mutations: Record<string, unknown> = {
      refreshDataTable: mockRefreshTable,
      listGa4Properties: mockListGa4Properties,
      listPostgresTables: mockListPostgresTables,
      listNotionDatabases: vi.fn(),
      prepareRemoteDataTable: mockPrepareRemoteDataTable,
      fetchData: mockInitialFetch,
    };
    if (!(ref._path in mutations)) {
      throw new Error(`Unexpected mutation: ${ref._path}`);
    }
    return { mutateAsync: mutations[ref._path] };
  }),
}));

vi.mock("@/hooks/useCreateInsight", () => ({
  useCreateInsight: () => ({
    createInsightFromTable: mockCreateInsightFromTable,
  }),
}));

vi.mock("@/hooks/useDataFrameData", () => ({
  useDataFrameData: () => mockUseDataFrameData(),
}));

vi.mock("@/lib/connectors/registry", () => ({
  getConnectorById: (id: string) => {
    if (id === "postgres")
      return { name: "PostgreSQL", sourceType: "remote-api", icon: "" };
    if (id === "local")
      return { name: "Local Files", sourceType: "file", icon: "" };
    if (id === "googleAnalytics")
      return {
        name: "Google Analytics",
        sourceType: "remote-api",
        authKind: "oauth",
        icon: "",
      };
    return null;
  },
  useRegistryVersion: () => 0,
}));

vi.mock("@/lib/perf", () => ({
  PerfStage: { CommandApply: "command-apply" },
  withPerfAsync: (_stage: unknown, fn: () => unknown) => fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: vi.fn() },
}));

vi.mock("@dashframe/engine", () => ({
  extractColumnAliasComponents: vi.fn(() => null),
}));

// The app shell's chrome is not under test; render the page body directly.
vi.mock("@/components/layouts/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => mockNavigate,
}));

// The grid is virtualised and measures layout jsdom does not have. The stub
// keeps its contract: one header button per visible column, labelled as
// configured, reporting clicks through onHeaderClick.
vi.mock("@dashframe/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dashframe/ui")>()),
  VirtualTable: ({
    rows,
    columns,
    columnConfigs,
    onHeaderClick,
  }: import("@dashframe/ui").VirtualTableProps) => (
    <div data-testid="virtual-table" data-rows={rows?.length}>
      {(columns ?? [])
        .filter(
          (column) =>
            !columnConfigs?.find((config) => config.id === column.name)?.hidden,
        )
        .map((column) => {
          const config = columnConfigs?.find(
            (candidate) => candidate.id === column.name,
          );
          return (
            <button
              key={column.name}
              type="button"
              aria-pressed={Boolean(config?.highlight)}
              onClick={() => onHeaderClick?.(column.name)}
            >
              {config?.label ?? column.name}
            </button>
          );
        })}
    </div>
  ),
}));

// The file picker is its own tested surface; here only its hand-back matters.
vi.mock("@/components/data-sources/DataPickerModal", () => ({
  DataPickerModal: ({
    isOpen,
    title,
    onTableSelect,
  }: {
    isOpen: boolean;
    title: string;
    onTableSelect: (tableId: string, tableName: string) => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button
          type="button"
          onClick={() => onTableSelect("table-uploaded", "Uploaded")}
        >
          Upload a file
        </button>
      </div>
    ) : null,
}));

// ── Component under test ──────────────────────────────────────────────────────

import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  TopBarTabsProvider,
  useRegisteredTopBarTabs,
} from "@/components/shell/topbar-tabs";
import { PlatformProvider } from "@/lib/platform";
import { useConfirmDialogStore } from "@/lib/stores";
import { useShellStore } from "@/lib/stores/shell-store";
import { extractColumnAliasComponents } from "@dashframe/engine";
import type { DataSource, DataTable, Field, UUID } from "@dashframe/types";
import { CONNECTOR_SIGN_IN_EXPIRED } from "@dashframe/types";
import { useState } from "react";
import DataSourcePageContent, {
  buildAnalysisByFieldId,
} from "./DataSourcePageContent";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SOURCE_ID = "source-abc-123" as UUID;
const FRAME_ID = "frame-1" as UUID;

const FILE_SOURCE = {
  id: SOURCE_ID,
  name: "Local Files",
  type: "local",
  config: { hasApiKey: false, hasConnectionString: false },
  createdAt: 0,
} satisfies DataSource;
const POSTGRES_SOURCE = {
  ...FILE_SOURCE,
  name: "Warehouse",
  type: "postgres",
  config: { hasApiKey: false, hasConnectionString: true },
} satisfies DataSource;
const GA4_SOURCE = {
  ...FILE_SOURCE,
  name: "Web analytics",
  type: "googleAnalytics",
} satisfies DataSource;

function field(id: string, name: string, extra: Partial<Field> = {}): Field {
  return {
    id: id as UUID,
    name,
    tableId: "table-orders" as UUID,
    columnName: name.toLowerCase(),
    type: "string",
    ...extra,
  };
}

function table(
  id: string,
  name: string,
  extra: Partial<DataTable> = {},
): DataTable {
  return {
    id: id as UUID,
    name,
    dataSourceId: SOURCE_ID,
    table: `${name.toLowerCase()}.csv`,
    fields: [],
    metrics: [],
    createdAt: 0,
    ...extra,
  };
}

const ORDERS = table("table-orders", "Orders", {
  dataFrameId: FRAME_ID,
  fields: [
    field("field-region", "Region"),
    field("field-amount", "Amount", { type: "number" }),
    field("field-email", "Customer email"),
  ],
});
const CUSTOMERS = table("table-customers", "Customers");

/**
 * The real `useDataFrameData` always returns all of these fields; building the
 * stub through this helper keeps a test from exercising a shape the hook never
 * produces.
 */
function previewResult(
  overrides: {
    data?: { rows: Record<string, unknown>[]; columns: { name: string }[] };
    isLoading?: boolean;
    error?: string | null;
  } = {},
) {
  return {
    data: overrides.data ?? null,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    entry: undefined,
    reload: mockReloadPreview,
  };
}

const ORDERS_PREVIEW = previewResult({
  data: {
    columns: [
      { name: "region" },
      { name: "amount" },
      { name: "customer email" },
    ],
    rows: [
      { region: "North", amount: 12, "customer email": "a@example.com" },
      { region: "South", amount: 30, "customer email": "b@example.com" },
      { region: "North", amount: 7, "customer email": "c@example.com" },
    ],
  },
});

function givenSource(source: DataSource, tables: DataTable[] = []) {
  mockUseDataSources.mockReturnValue({ data: [source] });
  mockUseDataTables.mockReturnValue({ data: tables });
}

/** Mirrors the top-bar slot: what the page registered, as clickable tabs. */
function TopBarProbe() {
  const tabs = useRegisteredTopBarTabs();
  if (!tabs) return <p data-testid="no-tabs" />;
  return (
    <div role="tablist" aria-label={tabs.label}>
      {tabs.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === tabs.activeId}
          onClick={() => tabs.onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** The route's part: the open tab lives in the URL, here in state. */
function Page({
  sourceId = SOURCE_ID,
  initialTableId = null,
}: {
  sourceId?: string;
  initialTableId?: string | null;
}) {
  const [tableId, setTableId] = useState<string | null>(initialTableId);
  return (
    <PlatformProvider>
      <TopBarTabsProvider>
        <TopBarProbe />
        <DataSourcePageContent
          sourceId={sourceId}
          tableId={tableId}
          onSelectTable={setTableId}
        />
        <ConfirmDialog />
      </TopBarTabsProvider>
    </PlatformProvider>
  );
}

const nameInput = () =>
  screen.getByRole("textbox", { name: "Data source name" }) as HTMLInputElement;
const tabs = () => within(screen.getByRole("tablist", { name: "Tables" }));
const inspector = () => screen.queryByRole("textbox", { name: "Display name" });

beforeEach(() => {
  vi.clearAllMocks();
  useConfirmDialogStore.getState().close();
  useShellStore.setState({ workbenchPanes: {} });
  mockCommitBatch.mockResolvedValue({ results: [] });
  mockUseDataFrames.mockReturnValue({ data: [{ id: FRAME_ID, rowCount: 3 }] });
  mockUseDataFrameData.mockReturnValue(previewResult());
  mockCreateInsightFromTable.mockResolvedValue("insight-1");
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DataSourcePageContent — loading contract", () => {
  it("shows loading while the sources query is pending, then the source — never 'not found'", async () => {
    mockUseDataSources.mockReturnValue({ isLoading: true });
    mockUseDataTables.mockReturnValue({ data: [] });
    const { rerender } = render(<Page />);

    screen.getByText("Loading data source…");
    expect(screen.queryByText("Data source not found")).toBeNull();

    mockUseDataSources.mockReturnValue({ data: [FILE_SOURCE] });
    await act(async () => rerender(<Page />));

    expect(screen.queryByText("Data source not found")).toBeNull();
    expect(nameInput().value).toBe("Local Files");
  });

  it("shows 'not found' only once loading completes without the source", async () => {
    mockUseDataSources.mockReturnValue({ isLoading: true });
    mockUseDataTables.mockReturnValue({ data: [] });
    const { rerender } = render(<Page sourceId="missing" />);
    expect(screen.queryByText("Data source not found")).toBeNull();

    mockUseDataSources.mockReturnValue({ data: [FILE_SOURCE] });
    await act(async () => rerender(<Page sourceId="missing" />));

    screen.getByText("Data source not found");
  });

  it("waits for tables before claiming the source has none", () => {
    mockUseDataSources.mockReturnValue({ data: [FILE_SOURCE] });
    mockUseDataTables.mockReturnValue({ isLoading: true });
    render(<Page />);

    screen.getByText("Loading tables…");
    expect(screen.queryByText("No tables yet")).toBeNull();
    screen.getByTestId("no-tabs");
  });

  it("shows a table-query error without claiming the source has no tables", () => {
    mockUseDataSources.mockReturnValue({ data: [FILE_SOURCE] });
    mockUseDataTables.mockReturnValue({ isError: true });
    render(<Page />);

    screen.getByRole("heading", { name: "Couldn't load tables" });
    screen.getByRole("alert");
    expect(screen.queryByText("No tables yet")).toBeNull();
  });
});

describe("DataSourcePageContent — table tabs", () => {
  it("puts one top-bar tab per table and opens the first by default", () => {
    givenSource(FILE_SOURCE, [ORDERS, CUSTOMERS]);
    render(<Page />);

    const strip = tabs();
    expect(strip.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Orders",
      "Customers",
    ]);
    expect(
      strip.getByRole("tab", { name: "Orders" }).getAttribute("aria-selected"),
    ).toBe("true");
    screen.getByRole("tabpanel", { name: "Orders" });
  });

  it("opens the tab named in the URL and switches when another is chosen", () => {
    givenSource(FILE_SOURCE, [ORDERS, CUSTOMERS]);
    render(<Page initialTableId="table-customers" />);
    screen.getByRole("tabpanel", { name: "Customers" });

    fireEvent.click(tabs().getByRole("tab", { name: "Orders" }));
    screen.getByRole("tabpanel", { name: "Orders" });
  });

  it("falls back to the first table when the URL names one that is gone", () => {
    givenSource(FILE_SOURCE, [ORDERS, CUSTOMERS]);
    render(<Page initialTableId="table-deleted" />);

    screen.getByRole("tabpanel", { name: "Orders" });
  });

  it("registers no tabs for a source without tables", () => {
    givenSource(FILE_SOURCE, []);
    render(<Page />);

    screen.getByTestId("no-tabs");
  });
});

describe("DataSourcePageContent — source configuration pane", () => {
  it("names a remote source's connection and what credential it stores, never the value", () => {
    givenSource(POSTGRES_SOURCE, [ORDERS]);
    render(<Page />);

    screen.getByRole("heading", { name: "Source" });
    screen.getByText("PostgreSQL");
    screen.getByText("Connection string stored");
    screen.getByText("Manual");
  });

  it("gives a file-backed table's provenance instead of credentials", () => {
    givenSource(FILE_SOURCE, [ORDERS]);
    render(<Page />);

    screen.getByText("orders.csv");
    expect(screen.queryByText("Credentials")).toBeNull();
  });

  it("renames the source in place when the name field is left", async () => {
    givenSource(FILE_SOURCE, [ORDERS]);
    render(<Page />);

    fireEvent.change(nameInput(), { target: { value: "My uploads" } });
    expect(mockCommitBatch).not.toHaveBeenCalled();
    await act(async () => fireEvent.blur(nameInput()));

    expect(mockCommitBatch).toHaveBeenCalledWith({
      commands: [
        { path: "renameNode", args: { id: SOURCE_ID, name: "My uploads" } },
      ],
    });
  });

  it("restores the saved name and says so when a rename fails", async () => {
    givenSource(FILE_SOURCE, [ORDERS]);
    mockCommitBatch.mockRejectedValue(new Error("write failed"));
    render(<Page />);

    fireEvent.change(nameInput(), { target: { value: "My uploads" } });
    await act(async () => fireEvent.blur(nameInput()));

    expect(mockToastError).toHaveBeenCalledWith("Failed to rename data source");
    expect(nameInput().value).toBe("Local Files");
  });
});

describe("DataSourcePageContent — table actions", () => {
  it("refreshes the open remote table and surfaces a failed result", async () => {
    givenSource(POSTGRES_SOURCE, [ORDERS]);
    mockRefreshTable.mockResolvedValue({
      status: "failed",
      message: "Connection unavailable",
    });
    render(<Page />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Refresh" })),
    );

    expect(mockRefreshTable).toHaveBeenCalledWith({ tableId: "table-orders" });
    expect(mockToastError).toHaveBeenCalledWith(
      "Could not refresh Orders: Connection unavailable",
    );
  });

  it("starts a report and opens the table's question in that report", async () => {
    givenSource(FILE_SOURCE, [ORDERS]);
    render(<Page />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Start a report" })),
    );

    const [{ commands }] = mockCommitBatch.mock.calls[0];
    expect(commands).toEqual([
      {
        path: "createDashboardCmd",
        args: { id: expect.any(String), name: "Untitled report" },
      },
    ]);
    expect(mockCreateInsightFromTable).toHaveBeenCalledWith(
      "table-orders",
      "Orders",
      { visualize: true, reportId: commands[0].args.id },
    );
  });

  it("removes the new report again when its question cannot be opened", async () => {
    givenSource(FILE_SOURCE, [ORDERS]);
    mockCreateInsightFromTable.mockResolvedValue(null);
    render(<Page />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Start a report" })),
    );

    const reportId = mockCommitBatch.mock.calls[0][0].commands[0].args.id;
    expect(mockCommitBatch).toHaveBeenLastCalledWith({
      commands: [{ path: "deleteNode", args: { id: reportId } }],
    });
  });

  it("starts one report however often the button is pressed while it works", async () => {
    givenSource(FILE_SOURCE, [ORDERS]);
    let openQuestion: (id: string) => void = () => {};
    mockCreateInsightFromTable.mockReturnValue(
      new Promise((resolve) => {
        openQuestion = resolve;
      }),
    );
    render(<Page />);

    const start = screen.getByRole("button", { name: "Start a report" });
    await act(async () => fireEvent.click(start));
    await act(async () => fireEvent.click(start));
    await act(async () => openQuestion("insight-1"));

    expect(mockCommitBatch).toHaveBeenCalledTimes(1);
  });

  it("does not open a question when the report cannot be created", async () => {
    givenSource(FILE_SOURCE, [ORDERS]);
    mockCommitBatch.mockRejectedValue(new Error("write failed"));
    render(<Page />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Start a report" })),
    );

    expect(mockToastError).toHaveBeenCalledWith("Couldn't start a report");
    expect(mockCreateInsightFromTable).not.toHaveBeenCalled();
  });

  it("deletes the open table only after confirmation", async () => {
    const user = userEvent.setup();
    givenSource(FILE_SOURCE, [ORDERS]);
    render(<Page />);

    await user.click(
      screen.getByRole("button", { name: "More table actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Delete table/ }),
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      'Are you sure you want to delete "Orders"?',
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCommitBatch).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "More table actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Delete table/ }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: [{ path: "deleteNode", args: { id: "table-orders" } }],
      }),
    );
  });
});

describe("DataSourcePageContent — preview and column inspector", () => {
  beforeEach(() => {
    givenSource(FILE_SOURCE, [ORDERS]);
    mockUseDataFrameData.mockReturnValue(ORDERS_PREVIEW);
  });

  it("heads the grid with display names and opens no inspector until a column is chosen", () => {
    render(<Page />);

    screen.getByRole("button", { name: "Customer email" });
    expect(inspector()).toBeNull();
    expect(screen.queryByRole("button", { name: /Column pane$/ })).toBeNull();
  });

  it("inspects the column whose header is clicked, with its type, samples and sensitivity", () => {
    render(<Page />);

    fireEvent.click(screen.getByRole("button", { name: "Region" }));

    expect((inspector() as HTMLInputElement).value).toBe("Region");
    screen.getByRole("heading", { name: "Column" });
    screen.getByText("North");
    screen.getByText("South");
    screen.getByText("Unclassified");
    // Sensitivity is decided in the inspector, not flagged across the grid.
    expect(screen.getAllByText("Unclassified")).toHaveLength(1);
    expect(
      screen
        .getByRole("button", { name: "Region" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("marks the inspected column safe", async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Region" }));

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Mark safe" })),
    );

    expect(mockCommitBatch).toHaveBeenCalledWith({
      commands: [
        {
          path: "updateField",
          args: {
            nodeId: "table-orders",
            fieldId: "field-region",
            updates: {
              sensitivity: "cleared",
              sensitivityReason: "Cleared by you",
              sensitivitySource: "user",
            },
          },
        },
      ],
    });
  });

  it("renames the inspected column when its name field is left", async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Amount" }));

    fireEvent.change(inspector()!, { target: { value: "Order total" } });
    await act(async () => fireEvent.blur(inspector()!));

    expect(mockCommitBatch).toHaveBeenCalledWith({
      commands: [
        {
          path: "updateField",
          args: {
            nodeId: "table-orders",
            fieldId: "field-amount",
            updates: { name: "Order total" },
          },
        },
      ],
    });
  });

  it("puts the saved column name back when a rename fails", async () => {
    mockCommitBatch.mockRejectedValue(new Error("write failed"));
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Amount" }));

    fireEvent.change(inspector()!, { target: { value: "Order total" } });
    await act(async () => fireEvent.blur(inspector()!));

    expect(mockToastError).toHaveBeenCalledWith("Failed to rename column");
    expect((inspector() as HTMLInputElement).value).toBe("Amount");
  });

  it("clears the column choice when another table is opened", () => {
    givenSource(FILE_SOURCE, [ORDERS, CUSTOMERS]);
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Region" }));
    expect(inspector()).not.toBeNull();

    fireEvent.click(tabs().getByRole("tab", { name: "Customers" }));
    expect(inspector()).toBeNull();
  });

  it("narrows the grid to the columns matching 'Find column'", () => {
    render(<Page />);

    fireEvent.change(screen.getByRole("textbox", { name: "Find column" }), {
      target: { value: "am" },
    });
    screen.getByRole("button", { name: "Amount" });
    expect(screen.queryByRole("button", { name: "Region" })).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Find column" }), {
      target: { value: "zzz" },
    });
    screen.getByText(/No columns match/);
    expect(screen.queryByTestId("virtual-table")).toBeNull();
  });

  it("lists columns with their type and sample in the Columns view", () => {
    render(<Page />);

    fireEvent.click(screen.getByRole("tab", { name: "Columns" }));
    const list = within(screen.getByRole("list", { name: "Columns" }));
    const amount = list.getByRole("button", { name: /Amount/ });
    expect(amount.textContent).toContain("number");
    expect(amount.textContent).toContain("12, 30, 7");

    fireEvent.click(amount);
    expect((inspector() as HTMLInputElement).value).toBe("Amount");
  });
});

describe("DataSourcePageContent — preview states", () => {
  beforeEach(() => givenSource(FILE_SOURCE, [ORDERS]));

  it("shows the loading state while the preview page is in flight", () => {
    mockUseDataFrameData.mockReturnValue(previewResult({ isLoading: true }));
    render(<Page />);

    screen.getByText("Loading rows…");
    expect(screen.queryByText("This table has no rows.")).toBeNull();
  });

  it("shows a failed preview with a retry, not as an empty table", () => {
    mockUseDataFrameData.mockReturnValue(
      previewResult({ error: "connection reset" }),
    );
    render(<Page />);

    screen.getByText("Couldn't load the preview");
    expect(screen.queryByText("This table has no rows.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockReloadPreview).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state only for a successful zero-row result", () => {
    mockUseDataFrameData.mockReturnValue(
      previewResult({ data: { rows: [], columns: [{ name: "region" }] } }),
    );
    render(<Page />);

    screen.getByText("This table has no rows.");
    expect(screen.queryByTestId("virtual-table")).toBeNull();
  });
});

describe("DataSourcePageContent — source without tables", () => {
  it("offers a local-files source one way in: import a file", () => {
    givenSource(FILE_SOURCE, []);
    render(<Page />);

    screen.getByRole("heading", { name: "No tables yet" });
    fireEvent.click(screen.getByRole("button", { name: "Import file" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Import a file" })).getByRole(
        "button",
        { name: "Upload a file" },
      ),
    );
    expect(screen.queryByRole("dialog", { name: "Import a file" })).toBeNull();
  });

  it("imports another table from a remote source, offering only what is not a table yet", async () => {
    givenSource(POSTGRES_SOURCE, [
      table("table-orders", "Orders", { table: "public.orders" }),
    ]);
    mockListPostgresTables.mockResolvedValue([
      { id: "public.orders", title: "orders" },
      { id: "public.refunds", title: "refunds" },
    ]);
    render(<Page />);

    fireEvent.click(screen.getByRole("button", { name: "Import table" }));

    await screen.findByRole("button", { name: "refunds" });
    expect(screen.queryByRole("button", { name: "orders" })).toBeNull();
    expect(mockListPostgresTables).toHaveBeenCalledWith({
      dataSourceId: SOURCE_ID,
    });
  });

  it("points a source it cannot list at Add Source", () => {
    givenSource({ ...FILE_SOURCE, type: "unknown" }, []);
    render(<Page />);

    screen.getByText("Choose tables from Add Source on the Data Sources page.");
    screen.getByRole("button", { name: "Go to Data Sources" });
  });
});

describe("DataSourcePageContent — connected GA4 source with no tables", () => {
  beforeEach(() => {
    givenSource(GA4_SOURCE, []);
    mockPrepareRemoteDataTable.mockResolvedValue({ fields: [] });
    mockInitialFetch.mockResolvedValue({ status: "ready" });
  });

  it("lists the account's properties and imports the chosen one as a table", async () => {
    mockListGa4Properties.mockResolvedValue([
      { id: "properties/111", title: "Marketing site" },
      { id: "properties/222", title: "Store" },
    ]);
    let finishFetch: (value: { status: "ready" }) => void = () => {};
    mockInitialFetch.mockReturnValue(
      new Promise((resolve) => {
        finishFetch = resolve;
      }),
    );
    render(<Page />);

    screen.getByRole("heading", { name: "Choose a property to import" });
    expect(mockListGa4Properties).toHaveBeenCalledWith({
      dataSourceId: SOURCE_ID,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Store" }));

    await waitFor(() =>
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: [
          expect.objectContaining({
            args: expect.objectContaining({
              dataSourceId: SOURCE_ID,
              name: "Store",
              table: "properties/222",
            }),
          }),
        ],
      }),
    );
    const tableId = mockCommitBatch.mock.calls[0][0].commands[0].args.id;
    await waitFor(() =>
      expect(mockInitialFetch).toHaveBeenCalledWith({
        insight: { baseTableId: tableId, selectedFields: [], metrics: [] },
      }),
    );
    // Neither row can start a second import while this one runs.
    expect(
      (screen.getByRole("button", { name: "Store" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Marketing site",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await act(async () => finishFetch({ status: "ready" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the picker, and no tabs, while an import's table appears and is rolled back", async () => {
    mockListGa4Properties.mockResolvedValue([
      { id: "properties/222", title: "Store" },
    ]);
    let finishFetch: (value: {
      status: "failed";
      message: string;
    }) => void = () => {};
    mockInitialFetch.mockReturnValue(
      new Promise((resolve) => {
        finishFetch = resolve;
      }),
    );
    const view = render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Store" }));
    await waitFor(() => expect(mockInitialFetch).toHaveBeenCalled());

    // The subscription shows the in-flight table before the import settles.
    const tableId = mockCommitBatch.mock.calls[0][0].commands[0].args.id;
    mockUseDataTables.mockReturnValue({ data: [table(tableId, "Store")] });
    view.rerender(<Page />);
    screen.getByRole("heading", { name: "Choose a property to import" });
    screen.getByTestId("no-tabs");

    // The fetch fails; the import removes its table again.
    mockUseDataTables.mockReturnValue({ data: [] });
    await act(async () =>
      finishFetch({ status: "failed", message: "Google Analytics is busy." }),
    );
    view.rerender(<Page />);

    expect(screen.getByRole("alert").textContent).toBe(
      "Google Analytics is busy.",
    );
  });

  it("asks for a new Google sign-in when the stored grant is unusable", async () => {
    mockListGa4Properties.mockRejectedValue(
      new Error(CONNECTOR_SIGN_IN_EXPIRED),
    );
    render(<Page />);

    await screen.findByText("Google sign-in expired.");
    screen.getByRole("button", { name: "Go to Data Sources" });
    expect(screen.queryByText(CONNECTOR_SIGN_IN_EXPIRED)).toBeNull();
    screen.getByText("Account sign-in");
  });

  it("offers a retry, not raw error text, when properties fail to load", async () => {
    mockListGa4Properties
      .mockRejectedValueOnce(
        new Error("[GA4Connector] Google API request failed (503)"),
      )
      .mockResolvedValueOnce([
        { id: "properties/111", title: "Marketing site" },
      ]);
    render(<Page />);

    await screen.findByText("Couldn't load your Google Analytics properties.");
    expect(screen.queryByText(/GA4Connector/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Marketing site" });
  });
});

// ── buildAnalysisByFieldId — repeat-join identity ────────────────────────────
//
// Two analysis columns for the same base field but different join instances
// must occupy distinct map entries; j1 must never overwrite j0.

describe("buildAnalysisByFieldId — repeat-join identity", () => {
  const UUID_A = "dd05ef4b-1234-5678-abcd-ef1234567890";
  const COL_J0 = `field_${UUID_A.replace(/-/g, "_")}`;
  const COL_J1 = `${COL_J0}_j1`;
  const SINGLE_UUID = "ccbbaa99-1234-5678-abcd-ef1234567890";
  const COL_SINGLE = `field_${SINGLE_UUID.replace(/-/g, "_")}`;

  // Inline parser matching the real extractColumnAliasComponents behaviour.
  const realParser = (alias: string) => {
    const m = alias.match(/^(?:field|metric)_(.+)$/);
    if (!m) return null;
    const raw = m[1] ?? "";
    const inst = raw.match(/^(.+)_j(\d+)$/);
    const uuidRaw = inst ? (inst[1] ?? "") : raw;
    const instanceIndex = inst ? parseInt(inst[2] ?? "0", 10) : 0;
    const parts = uuidRaw.split("_");
    const uuid =
      parts.length === 5 ? parts.join("-") : uuidRaw.replace(/_/g, "-");
    return { uuid, instanceIndex };
  };

  beforeEach(() => {
    vi.mocked(extractColumnAliasComponents).mockImplementation(realParser);
  });

  afterEach(() => {
    vi.mocked(extractColumnAliasComponents).mockReturnValue(null);
  });

  it("maps j0 column to the bare UUID key", () => {
    const col = makeCol(COL_J0, 5);
    const map = buildAnalysisByFieldId([col]);
    expect(map.get(UUID_A)).toBe(col);
  });

  it("maps j1 column to <uuid>_j1 key — does NOT overwrite j0", () => {
    const j0 = makeCol(COL_J0, 5);
    const j1 = makeCol(COL_J1, 15);
    const map = buildAnalysisByFieldId([j0, j1]);

    expect(map.size).toBe(2);
    expect(map.get(UUID_A)).toBe(j0);
    expect(map.get(`${UUID_A}_j1`)).toBe(j1);
  });

  it("single-join (no _j suffix) uses the bare UUID key", () => {
    const map = buildAnalysisByFieldId([makeCol(COL_SINGLE, 10)]);

    expect(map.has(SINGLE_UUID)).toBe(true);
    expect(map.size).toBe(1);
    expect(map.has(`${SINGLE_UUID}_j0`)).toBe(false);
  });

  it("prefers explicit fieldId over parsed columnName when fieldId is set", () => {
    const col = { ...makeCol(COL_J0, 3), fieldId: "explicit-field-id" };
    const map = buildAnalysisByFieldId([col]);

    expect(map.get("explicit-field-id")).toBe(col);
    expect(map.has(UUID_A)).toBe(false);
  });
});

// Minimal categorical ColumnAnalysis fixture.
function makeCol(
  columnName: string,
  cardinality: number,
): import("@dashframe/types").ColumnAnalysis {
  return {
    columnName,
    dataType: "string",
    semantic: "categorical",
    cardinality,
    uniqueness: 0.5,
    nullCount: 0,
    sampleValues: [],
  };
}

import {
  FileSourceConnector,
  type FileParseResult,
  type FormField,
  type ValidationResult,
} from "@dashframe/engine";
import type { DataSource, DataTable, UUID } from "@dashframe/types";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConfirmDialogStore } from "@/lib/stores";
import type { AddConnectionPanelProps } from "./AddConnectionPanel";

const {
  mockGetConnectorById,
  mockHandleFileConnectorResult,
  mockParse,
  queryData,
} = vi.hoisted(() => ({
  mockGetConnectorById: vi.fn(),
  mockHandleFileConnectorResult: vi.fn(),
  mockParse: vi.fn(),
  queryData: {
    dataSources: [] as DataSource[],
    dataTables: [] as DataTable[],
    dataSourcesQueryState: {} as { isLoading?: boolean; isError?: boolean },
    dataTablesQueryState: {} as { isLoading?: boolean; isError?: boolean },
  },
}));

let handleFileSelect: AddConnectionPanelProps["onFileSelect"] | undefined;

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => {
      switch (ref._path) {
        case "listDataSources":
          return {
            data: queryData.dataSources,
            ...queryData.dataSourcesQueryState,
          };
        case "listDataTables":
          return {
            data: queryData.dataTables,
            ...queryData.dataTablesQueryState,
          };
        case "listInsights":
        case "listDataFrames":
          return { data: [] };
        default:
          throw new Error(`Unexpected query: ${ref._path}`);
      }
    },
    useMutation: () => ({ mutateAsync: vi.fn() }),
  };
});

vi.mock("@/lib/connectors/registry", () => ({
  getConnectorById: mockGetConnectorById,
}));

vi.mock("@/lib/local-csv-handler", () => ({
  handleFileConnectorResult: mockHandleFileConnectorResult,
}));

vi.mock("./AddConnectionPanel", () => ({
  AddConnectionPanel: ({
    onFileSelect,
  }: Pick<AddConnectionPanelProps, "onFileSelect">) => {
    handleFileSelect = onFileSelect;
    return <div data-testid="add-connection-panel" />;
  },
}));

vi.mock("./DataSourceList", () => ({ DataSourceList: () => null }));
vi.mock("./DataTableList", () => ({ DataTableList: () => null }));
vi.mock("./InsightList", () => ({ InsightList: () => null }));
vi.mock("@wystack/ui-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/ui-react")>();
  return {
    ...actual,
    SectionList: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});
vi.mock("@wystack/ui-react/icons", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@wystack/ui-react/icons")>();
  return { ...actual, ArrowLeftIcon: () => null };
});

import { ConfirmDialog } from "../confirm-dialog";
import { DataPickerContent } from "./DataPickerContent";
import { DataPickerModal } from "./DataPickerModal";

const FILE_SOURCE_ID = "file-source-id" as UUID;
const REMOTE_SOURCE_ID = "remote-source-id" as UUID;
const FILE_TABLE_ID = "file-table-id" as UUID;
const REMOTE_TABLE_ID = "remote-table-id" as UUID;
const NEW_TABLE_ID = "new-table-id" as UUID;
const PARSE_RESULT = {} as FileParseResult;

class TestFileConnector extends FileSourceConnector {
  readonly id = "local";
  readonly name = "CSV upload";
  readonly description = "Upload CSV files.";
  readonly icon = "";
  readonly accept = ".csv";

  getFormFields(): FormField[] {
    return [];
  }

  validate(): ValidationResult {
    return { valid: true };
  }

  async parse(_file: File, _tableId: UUID): Promise<FileParseResult> {
    mockParse(_file, _tableId);
    return PARSE_RESULT;
  }
}

const fileConnector = new TestFileConnector();

function makeSource(id: UUID, name: string, type: string): DataSource {
  return {
    id,
    name,
    type,
    config: { hasApiKey: false, hasConnectionString: false },
    createdAt: 0,
  };
}

function makeTable(id: UUID, dataSourceId: UUID, name: string): DataTable {
  return {
    id,
    dataSourceId,
    name,
    table: name,
    fields: [],
    metrics: [],
    createdAt: 0,
  };
}

function uploadSalesCsv(): void {
  uploadFile("sales.csv");
}

function uploadFile(fileName: string): void {
  act(() => {
    handleFileSelect?.(fileConnector, new File(["amount\n10"], fileName));
  });
}

describe("DataPickerContent file replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleFileSelect = undefined;
    queryData.dataSources = [];
    queryData.dataTables = [];
    queryData.dataSourcesQueryState = {};
    queryData.dataTablesQueryState = {};
    mockGetConnectorById.mockImplementation((id: string) => {
      if (id === "local") return { name: "CSV upload", sourceType: "file" };
      if (id === "notion") return { name: "Notion", sourceType: "remote-api" };
      return undefined;
    });
    mockHandleFileConnectorResult.mockResolvedValue({
      dataTableId: NEW_TABLE_ID,
    });
    useConfirmDialogStore.setState({ isOpen: false, config: null });
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => NEW_TABLE_ID) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      useConfirmDialogStore.setState({ isOpen: false, config: null });
    });
  });

  it("creates a new table rather than offering to replace a same-named remote table", async () => {
    queryData.dataSources = [
      makeSource(REMOTE_SOURCE_ID, "Sales workspace", "notion"),
    ];
    queryData.dataTables = [
      makeTable(REMOTE_TABLE_ID, REMOTE_SOURCE_ID, "sales"),
    ];

    render(<DataPickerContent onTableSelect={vi.fn()} />);
    uploadSalesCsv();

    await waitFor(() => {
      expect(mockParse).toHaveBeenCalledWith(expect.any(File), NEW_TABLE_ID);
    });
    expect(useConfirmDialogStore.getState().config).toBeNull();
    expect(mockHandleFileConnectorResult).toHaveBeenCalledWith(
      "sales.csv",
      PARSE_RESULT,
      { overrideTableId: NEW_TABLE_ID },
    );
  });

  it("does not offer to replace an excluded file-backed table", async () => {
    queryData.dataSources = [
      makeSource(FILE_SOURCE_ID, "Quarterly CSV uploads", "local"),
    ];
    queryData.dataTables = [makeTable(FILE_TABLE_ID, FILE_SOURCE_ID, "sales")];

    render(
      <DataPickerContent
        excludeTableIds={[FILE_TABLE_ID]}
        onTableSelect={vi.fn()}
      />,
    );
    uploadSalesCsv();

    await waitFor(() => {
      expect(mockParse).toHaveBeenCalledWith(expect.any(File), NEW_TABLE_ID);
    });
    expect(useConfirmDialogStore.getState().config).toBeNull();
    expect(mockHandleFileConnectorResult).toHaveBeenCalledWith(
      "sales.csv",
      PARSE_RESULT,
      { overrideTableId: NEW_TABLE_ID },
    );
  });

  it("waits for data sources before allowing an upload", async () => {
    queryData.dataSourcesQueryState = { isLoading: true };

    render(<DataPickerContent onTableSelect={vi.fn()} />);
    uploadSalesCsv();

    await waitFor(() => {
      expect(mockParse).not.toHaveBeenCalled();
    });
    expect(mockHandleFileConnectorResult).not.toHaveBeenCalled();
  });

  it("waits for data tables before allowing an upload", async () => {
    queryData.dataTablesQueryState = { isLoading: true };

    render(<DataPickerContent onTableSelect={vi.fn()} />);
    uploadSalesCsv();

    await waitFor(() => {
      expect(mockParse).not.toHaveBeenCalled();
    });
    expect(mockHandleFileConnectorResult).not.toHaveBeenCalled();
  });

  it("confirms the named file-backed target before replacing it", async () => {
    queryData.dataSources = [
      makeSource(FILE_SOURCE_ID, "Quarterly CSV uploads", "local"),
    ];
    queryData.dataTables = [makeTable(FILE_TABLE_ID, FILE_SOURCE_ID, "sales")];

    render(<DataPickerContent onTableSelect={vi.fn()} />);
    uploadSalesCsv();

    await waitFor(() => {
      expect(useConfirmDialogStore.getState().config).not.toBeNull();
    });
    expect(useConfirmDialogStore.getState().config).toMatchObject({
      title: 'Replace table "sales" from "Quarterly CSV uploads"?',
      description:
        'The existing file-backed table "sales" from "Quarterly CSV uploads" will be overwritten by "sales.csv". Renamed or removed columns can break Insights that reference them.',
      confirmLabel: "Replace table",
      cancelLabel: "Cancel upload",
    });
    expect(mockParse).not.toHaveBeenCalled();

    act(() => {
      useConfirmDialogStore.getState().handleConfirm();
    });

    await waitFor(() => {
      expect(mockParse).toHaveBeenCalledWith(expect.any(File), FILE_TABLE_ID);
    });
    expect(mockHandleFileConnectorResult).toHaveBeenCalledWith(
      "sales.csv",
      PARSE_RESULT,
      { overrideTableId: FILE_TABLE_ID },
    );
  });

  it("returns before parsing when replacement is cancelled", async () => {
    queryData.dataSources = [
      makeSource(FILE_SOURCE_ID, "Quarterly CSV uploads", "local"),
    ];
    queryData.dataTables = [makeTable(FILE_TABLE_ID, FILE_SOURCE_ID, "sales")];

    render(<DataPickerContent onTableSelect={vi.fn()} />);
    uploadSalesCsv();

    await waitFor(() => {
      expect(useConfirmDialogStore.getState().config).not.toBeNull();
    });
    act(() => {
      useConfirmDialogStore.getState().handleCancel();
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockHandleFileConnectorResult).not.toHaveBeenCalled();
  });

  it("offers to replace a file-backed table when the same JSON file is uploaded twice", async () => {
    queryData.dataSources = [
      makeSource(FILE_SOURCE_ID, "Quarterly JSON uploads", "local"),
    ];

    const { rerender } = render(<DataPickerContent onTableSelect={vi.fn()} />);
    uploadFile("orders.json");

    await waitFor(() => {
      expect(mockParse).toHaveBeenCalledWith(expect.any(File), NEW_TABLE_ID);
    });
    queryData.dataTables = [makeTable(NEW_TABLE_ID, FILE_SOURCE_ID, "orders")];
    rerender(<DataPickerContent onTableSelect={vi.fn()} />);
    uploadFile("orders.json");

    await waitFor(() => {
      expect(useConfirmDialogStore.getState().config).toMatchObject({
        title: 'Replace table "orders" from "Quarterly JSON uploads"?',
      });
    });
    expect(mockParse).toHaveBeenCalledTimes(1);
  });

  it("renders the real destructive confirm dialog and replaces through its button", async () => {
    queryData.dataSources = [
      makeSource(FILE_SOURCE_ID, "Quarterly CSV uploads", "local"),
    ];
    queryData.dataTables = [makeTable(FILE_TABLE_ID, FILE_SOURCE_ID, "sales")];

    render(
      <>
        <DataPickerContent onTableSelect={vi.fn()} />
        <ConfirmDialog />
      </>,
    );
    await act(async () => {
      handleFileSelect?.(fileConnector, new File(["amount\n10"], "sales.csv"));
      await Promise.resolve();
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      'Replace table "sales" from "Quarterly CSV uploads"?',
    );
    expect(dialog.textContent).toContain(
      "Renamed or removed columns can break Insights that reference them.",
    );

    const confirmButton = screen.getByRole("button", {
      name: "Replace table",
    });
    expect(confirmButton.className).toContain("bg-palette-danger");
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    await waitFor(() => {
      expect(mockParse).toHaveBeenCalledWith(expect.any(File), FILE_TABLE_ID);
    });
    expect(mockHandleFileConnectorResult).toHaveBeenCalledWith(
      "sales.csv",
      PARSE_RESULT,
      { overrideTableId: FILE_TABLE_ID },
    );
  });

  it("replaces through the nested confirm dialog in the real picker modal", async () => {
    queryData.dataSources = [
      makeSource(FILE_SOURCE_ID, "Quarterly CSV uploads", "local"),
    ];
    queryData.dataTables = [makeTable(FILE_TABLE_ID, FILE_SOURCE_ID, "sales")];

    render(
      <>
        <DataPickerModal
          isOpen
          onClose={vi.fn()}
          title="Create Visualization"
          onTableSelect={vi.fn()}
        />
        <ConfirmDialog />
      </>,
    );
    uploadSalesCsv();

    const confirmDialog = await screen.findByRole("dialog", {
      name: 'Replace table "sales" from "Quarterly CSV uploads"?',
    });
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2);
    expect(confirmDialog.textContent).toContain(
      "Renamed or removed columns can break Insights that reference them.",
    );

    // userEvent (not fireEvent) so this exercises real pointer-events
    // through the nested dialog stack, not just a synthetic click
    // dispatched straight at the button node.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Replace table" }));

    await waitFor(() => {
      expect(mockParse).toHaveBeenCalledWith(expect.any(File), FILE_TABLE_ID);
    });
    expect(mockHandleFileConnectorResult).toHaveBeenCalledWith(
      "sales.csv",
      PARSE_RESULT,
      { overrideTableId: FILE_TABLE_ID },
    );
  });
});

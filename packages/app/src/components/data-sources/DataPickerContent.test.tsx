import {
  FileSourceConnector,
  type FileParseResult,
  type FormField,
  type ValidationResult,
} from "@dashframe/engine";
import type { DataSource, DataTable, UUID } from "@dashframe/types";
import { act, render, waitFor } from "@testing-library/react";
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
          return { data: queryData.dataSources };
        case "listDataTables":
          return { data: queryData.dataTables };
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
vi.mock("@wystack/ui-react", () => ({
  Button: () => null,
  SectionList: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@wystack/ui-react/icons", () => ({ ArrowLeftIcon: () => null }));

import { DataPickerContent } from "./DataPickerContent";

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
  act(() => {
    handleFileSelect?.(fileConnector, new File(["amount\n10"], "sales.csv"));
  });
}

describe("DataPickerContent file replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleFileSelect = undefined;
    queryData.dataSources = [];
    queryData.dataTables = [];
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
    useConfirmDialogStore.setState({ isOpen: false, config: null });
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
      undefined,
    );
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
      title: 'Replace table "sales" from "CSV upload"?',
      description:
        'The existing file-backed table "sales" from "CSV upload" will be overwritten by "sales.csv".',
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
});

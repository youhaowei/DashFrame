import type { DataTable, Field, UUID } from "@dashframe/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddDataFrameEntry,
  mockCsvToDataFrame,
  mockGetDataTable,
  mockGetOrCreateDataSourceByType,
  mockReplaceDataFrame,
  mockUpdateDataTable,
} = vi.hoisted(() => ({
  mockAddDataFrameEntry: vi.fn(),
  mockCsvToDataFrame: vi.fn(),
  mockGetDataTable: vi.fn(),
  mockGetOrCreateDataSourceByType: vi.fn(),
  mockReplaceDataFrame: vi.fn(),
  mockUpdateDataTable: vi.fn(),
}));

vi.mock("@/lib/data-access/data-frames", () => ({
  addDataFrameEntry: mockAddDataFrameEntry,
  replaceDataFrame: mockReplaceDataFrame,
}));
vi.mock("@/lib/data-access/data-sources", () => ({
  getOrCreateDataSourceByType: mockGetOrCreateDataSourceByType,
}));
vi.mock("@/lib/data-access/data-tables", () => ({
  createDataTable: vi.fn(),
  getDataTable: mockGetDataTable,
  updateDataTable: mockUpdateDataTable,
}));
vi.mock("@dashframe/csv", () => ({ csvToDataFrame: mockCsvToDataFrame }));

import {
  handleFileConnectorResult,
  handleLocalCSVUpload,
} from "./local-csv-handler";

const TABLE_ID = "table-id" as UUID;
const EXISTING_FIELD_ID = "existing-field-id" as UUID;
const NEW_FIELD_ID = "new-field-id" as UUID;
const DATA_SOURCE_ID = "data-source-id" as UUID;

const existingField: Field = {
  id: EXISTING_FIELD_ID,
  name: "amount",
  tableId: TABLE_ID,
  type: "number",
  sensitivity: "cleared",
  sensitivityReason: "Cleared by you",
  sensitivitySource: "user",
};

const parsedFields: Field[] = [
  {
    id: NEW_FIELD_ID,
    name: "amount",
    tableId: TABLE_ID,
    type: "string",
  },
  {
    id: "new-column-id" as UUID,
    name: "created_at",
    tableId: TABLE_ID,
    type: "date",
  },
];

const existingTable: DataTable = {
  id: TABLE_ID,
  dataSourceId: DATA_SOURCE_ID,
  name: "orders",
  table: "orders.csv",
  fields: [existingField],
  metrics: [],
  dataFrameId: "data-frame-id" as UUID,
  createdAt: 0,
};

const parsedResult = {
  dataFrame: { id: "replacement-data-frame-id" as UUID },
  fields: parsedFields,
  sourceSchema: { columns: [] },
  rowCount: 1,
  columnCount: 2,
};

describe("file table replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreateDataSourceByType.mockResolvedValue({ id: DATA_SOURCE_ID });
    mockGetDataTable.mockResolvedValue(existingTable);
    mockReplaceDataFrame.mockResolvedValue(undefined);
    mockUpdateDataTable.mockResolvedValue(undefined);
    mockCsvToDataFrame.mockResolvedValue(parsedResult);
  });

  it.each([
    [
      "handleLocalCSVUpload",
      () =>
        handleLocalCSVUpload(new File([], "orders.csv"), [], {
          overrideTableId: TABLE_ID,
        }),
    ],
    [
      "handleFileConnectorResult",
      () =>
        handleFileConnectorResult("orders.csv", parsedResult as never, {
          overrideTableId: TABLE_ID,
        }),
    ],
  ])(
    "%s retains matching field identities and sensitivity marks",
    async (_name, replace) => {
      await replace();

      expect(mockUpdateDataTable).toHaveBeenNthCalledWith(1, TABLE_ID, {
        name: "orders",
        table: "orders.csv",
        sourceSchema: parsedResult.sourceSchema,
        fields: [
          {
            ...parsedFields[0],
            id: EXISTING_FIELD_ID,
            sensitivity: "cleared",
            sensitivityReason: "Cleared by you",
            sensitivitySource: "user",
          },
          parsedFields[1],
        ],
        metrics: expect.any(Array),
      });
    },
  );
});

import type { DataTable, Field, Metric, UUID } from "@dashframe/types";
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
  columnName: "amount",
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
    columnName: "amount",
    type: "string",
  },
  {
    id: "new-column-id" as UUID,
    name: "created_at",
    tableId: TABLE_ID,
    columnName: "created_at",
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

const replacementHandlers = [
  {
    name: "handleLocalCSVUpload",
    replace: async (result = parsedResult) => {
      mockCsvToDataFrame.mockResolvedValue(result);
      return handleLocalCSVUpload(new File([], "orders.csv"), [], {
        overrideTableId: TABLE_ID,
      });
    },
  },
  {
    name: "handleFileConnectorResult",
    replace: (result = parsedResult) =>
      handleFileConnectorResult("orders.csv", result as never, {
        overrideTableId: TABLE_ID,
      }),
  },
];

describe("file table replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreateDataSourceByType.mockResolvedValue({ id: DATA_SOURCE_ID });
    mockGetDataTable.mockResolvedValue(existingTable);
    mockReplaceDataFrame.mockResolvedValue(undefined);
    mockUpdateDataTable.mockResolvedValue(undefined);
    mockCsvToDataFrame.mockResolvedValue(parsedResult);
  });

  it.each(replacementHandlers)(
    "$name retains matching field identities but resets cleared sensitivity",
    async ({ replace }) => {
      await replace();

      expect(mockUpdateDataTable).toHaveBeenNthCalledWith(1, TABLE_ID, {
        name: "orders",
        table: "orders.csv",
        sourceSchema: parsedResult.sourceSchema,
        fields: [
          {
            ...parsedFields[0],
            id: EXISTING_FIELD_ID,
            sensitivity: "unclassified",
            sensitivityReason: undefined,
            sensitivitySource: undefined,
          },
          parsedFields[1],
        ],
        metrics: expect.any(Array),
      });
    },
  );

  it.each(replacementHandlers)(
    "$name retains confirmed-sensitive fields across replacement",
    async ({ replace }) => {
      mockGetDataTable.mockResolvedValue({
        ...existingTable,
        fields: [
          {
            ...existingField,
            sensitivity: "sensitive",
            sensitivityReason: "Contains payment data",
            sensitivitySource: "classifier",
          },
        ],
      });

      await replace();

      expect(mockUpdateDataTable).toHaveBeenNthCalledWith(
        1,
        TABLE_ID,
        expect.objectContaining({
          fields: [
            {
              ...parsedFields[0],
              id: EXISTING_FIELD_ID,
              sensitivity: "sensitive",
              sensitivityReason: "Contains payment data",
              sensitivitySource: "classifier",
            },
            parsedFields[1],
          ],
        }),
      );
    },
  );

  it.each(replacementHandlers)(
    "$name drops metrics for removed columns but keeps Count",
    async ({ replace }) => {
      const countMetric: Metric = {
        id: "count-metric-id" as UUID,
        name: "Count",
        tableId: TABLE_ID,
        aggregation: "count",
      };
      const amountMetric: Metric = {
        id: "amount-metric-id" as UUID,
        name: "Sum of amount",
        tableId: TABLE_ID,
        columnName: "amount",
        aggregation: "sum",
      };
      mockGetDataTable.mockResolvedValue({
        ...existingTable,
        metrics: [amountMetric, countMetric],
      });
      const resultWithoutAmount = {
        ...parsedResult,
        fields: [parsedFields[1]],
        columnCount: 1,
      };

      await replace(resultWithoutAmount);

      expect(mockUpdateDataTable).toHaveBeenNthCalledWith(
        1,
        TABLE_ID,
        expect.objectContaining({
          fields: [parsedFields[1]],
          metrics: [countMetric],
        }),
      );
    },
  );

  it("matches user-renamed fields by source column name", async () => {
    mockGetDataTable.mockResolvedValue({
      ...existingTable,
      fields: [{ ...existingField, name: "Revenue" }],
    });

    await replacementHandlers[0].replace();

    expect(mockUpdateDataTable).toHaveBeenNthCalledWith(
      1,
      TABLE_ID,
      expect.objectContaining({
        fields: [
          {
            ...parsedFields[0],
            id: EXISTING_FIELD_ID,
            sensitivity: "unclassified",
            sensitivityReason: undefined,
            sensitivitySource: undefined,
          },
          parsedFields[1],
        ],
      }),
    );
  });

  it("does not reuse an id when a source column name is ambiguous", async () => {
    const duplicateParsedFields: Field[] = [
      parsedFields[0],
      {
        ...parsedFields[0],
        id: "second-new-field-id" as UUID,
        name: "duplicate_amount",
      },
    ];
    mockGetDataTable.mockResolvedValue({
      ...existingTable,
      fields: [
        existingField,
        {
          ...existingField,
          id: "second-existing-field-id" as UUID,
          name: "duplicate_amount",
        },
      ],
    });

    await replacementHandlers[0].replace({
      ...parsedResult,
      fields: duplicateParsedFields,
      columnCount: 2,
    });

    const [{ fields }] = mockUpdateDataTable.mock.calls[0].slice(1) as [
      { fields: Field[] },
    ];
    expect(fields).toEqual(duplicateParsedFields);
    expect(new Set(fields.map((field) => field.id))).toHaveLength(
      fields.length,
    );
  });

  it("does not reuse an id when only the new parse has a duplicate column name", async () => {
    const duplicateParsedFields: Field[] = [
      parsedFields[0],
      {
        ...parsedFields[0],
        id: "second-new-field-id" as UUID,
        name: "duplicate_amount",
      },
    ];
    // Existing side is unambiguous — a single field named "amount".
    mockGetDataTable.mockResolvedValue({
      ...existingTable,
      fields: [existingField],
    });

    await replacementHandlers[0].replace({
      ...parsedResult,
      fields: duplicateParsedFields,
      columnCount: 2,
    });

    const [{ fields }] = mockUpdateDataTable.mock.calls[0].slice(1) as [
      { fields: Field[] },
    ];
    expect(fields).toEqual(duplicateParsedFields);
    expect(new Set(fields.map((field) => field.id))).toHaveLength(
      fields.length,
    );
  });

  it("does not reuse an id when only the existing table has a duplicate column name", async () => {
    // Existing side is ambiguous — two fields both mapped to "amount".
    mockGetDataTable.mockResolvedValue({
      ...existingTable,
      fields: [
        existingField,
        {
          ...existingField,
          id: "second-existing-field-id" as UUID,
          name: "duplicate_amount",
        },
      ],
    });

    // New parse is unambiguous — a single "amount" column.
    await replacementHandlers[0].replace(parsedResult);

    const [{ fields }] = mockUpdateDataTable.mock.calls[0].slice(1) as [
      { fields: Field[] },
    ];
    expect(fields).toEqual(parsedFields);
    expect(new Set(fields.map((field) => field.id))).toHaveLength(
      fields.length,
    );
  });
});

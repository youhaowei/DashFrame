import type { Field, UUID } from "@dashframe/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  addDataFrameEntry,
  createDataFrame,
  deleteArrowData,
  getDataTable,
  removeDataFrame,
  updateDataTable,
} = vi.hoisted(() => ({
  addDataFrameEntry: vi.fn(),
  createDataFrame: vi.fn(),
  deleteArrowData: vi.fn(),
  getDataTable: vi.fn(),
  removeDataFrame: vi.fn(),
  updateDataTable: vi.fn(),
}));

vi.mock("@dashframe/core", () => ({
  addDataFrameEntry,
  getDataTable,
  removeDataFrame,
  updateDataTable,
}));

vi.mock("@dashframe/engine-browser", () => ({
  DataFrame: { create: createDataFrame },
  deleteArrowData,
}));

import { materializeRemoteTable } from "./remote-table-materialization";

const TABLE_ID = "11111111-1111-4111-8111-111111111111" as UUID;
const FRAME_ID = "22222222-2222-4222-8222-222222222222" as UUID;

function field(sensitivity?: Field["sensitivity"]): Field {
  return {
    id: crypto.randomUUID(),
    tableId: TABLE_ID,
    name: "email",
    columnName: "email",
    type: "string",
    sensitivity,
  };
}

function result(fields: Field[]) {
  return {
    arrowBuffer: "AQID",
    fieldIds: fields.map(({ id }) => id),
    fields,
    rowCount: 1,
  };
}

describe("materializeRemoteTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDataTable.mockResolvedValue({ id: TABLE_ID, fields: [] });
    addDataFrameEntry.mockResolvedValue(FRAME_ID);
    updateDataTable.mockResolvedValue(undefined);
    removeDataFrame.mockResolvedValue(undefined);
    deleteArrowData.mockResolvedValue(undefined);
    createDataFrame.mockImplementation(
      async (_bytes: Uint8Array, fieldIds: UUID[]) => ({
        id: FRAME_ID,
        fieldIds,
        storage: { type: "indexeddb", key: "arrow:new" },
        createdAt: 1,
        toJSON: () => ({}),
      }),
    );
  });

  it("rejects unclassified remote rows before creating durable storage", async () => {
    await expect(
      materializeRemoteTable({ id: TABLE_ID }, result([field()]), "Leads"),
    ).rejects.toThrow(
      "Every remote column must be reviewed and marked safe before local storage",
    );

    expect(createDataFrame).not.toHaveBeenCalled();
  });

  it("fails closed when field metadata is incomplete", async () => {
    const cleared = field("cleared");
    const incomplete = {
      ...result([cleared]),
      fieldIds: [cleared.id, crypto.randomUUID()],
    };

    await expect(
      materializeRemoteTable({ id: TABLE_ID }, incomplete, "Leads"),
    ).rejects.toThrow(
      "Every remote column must be reviewed and marked safe before local storage",
    );

    expect(createDataFrame).not.toHaveBeenCalled();
  });

  it("fails closed when the schema is empty", async () => {
    await expect(
      materializeRemoteTable({ id: TABLE_ID }, result([]), "Leads"),
    ).rejects.toThrow(
      "Every remote column must be reviewed and marked safe before local storage",
    );

    expect(createDataFrame).not.toHaveBeenCalled();
  });

  it("allows durable storage only when every field is cleared", async () => {
    await materializeRemoteTable(
      { id: TABLE_ID },
      result([field("cleared")]),
      "Leads",
    );

    expect(createDataFrame).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.any(Array),
    );
  });

  it("removes metadata and IndexedDB bytes when table linking fails", async () => {
    updateDataTable.mockRejectedValue(new Error("link failed"));

    await expect(
      materializeRemoteTable(
        { id: TABLE_ID },
        result([field("cleared")]),
        "Leads",
      ),
    ).rejects.toThrow("link failed");

    expect(removeDataFrame).toHaveBeenCalledWith(FRAME_ID);
    expect(deleteArrowData).toHaveBeenCalledWith("arrow:new");
  });

  it("surfaces an incomplete IndexedDB rollback", async () => {
    const linkError = new Error("link failed");
    const cleanupError = new Error("storage unavailable");
    updateDataTable.mockRejectedValue(linkError);
    deleteArrowData.mockRejectedValue(cleanupError);

    await expect(
      materializeRemoteTable(
        { id: TABLE_ID },
        result([field("cleared")]),
        "Leads",
      ),
    ).rejects.toMatchObject({
      message: "Failed to materialize and clean up the remote table",
      errors: [linkError, cleanupError],
    });
  });

  it("surfaces failure to clean up a replaced frame", async () => {
    const previousFrameId = "33333333-3333-4333-8333-333333333333" as UUID;
    getDataTable.mockResolvedValue({
      id: TABLE_ID,
      fields: [],
      dataFrameId: previousFrameId,
    });
    removeDataFrame.mockRejectedValue(new Error("cleanup failed"));

    await expect(
      materializeRemoteTable(
        { id: TABLE_ID },
        result([field("cleared")]),
        "Leads",
      ),
    ).rejects.toThrow("cleanup failed");

    expect(removeDataFrame).toHaveBeenCalledWith(previousFrameId);
  });
});

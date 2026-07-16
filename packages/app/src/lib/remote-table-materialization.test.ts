import type { Field, UUID } from "@dashframe/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  addDataFrameEntry,
  createDataFrame,
  deleteArrowData,
  getDataFrameEntry,
  getDataTable,
  removeDataFrame,
  updateDataTable,
} = vi.hoisted(() => ({
  addDataFrameEntry: vi.fn(),
  createDataFrame: vi.fn(),
  deleteArrowData: vi.fn(),
  getDataFrameEntry: vi.fn(),
  getDataTable: vi.fn(),
  removeDataFrame: vi.fn(),
  updateDataTable: vi.fn(),
}));

vi.mock("@dashframe/core", () => ({
  addDataFrameEntry,
  getDataFrameEntry,
  getDataTable,
  removeDataFrame,
  updateDataTable,
}));

vi.mock("@dashframe/engine-browser", () => ({
  DataFrame: { create: createDataFrame },
  deleteArrowData,
}));

import {
  materializeRemoteTable,
  RemoteTableReplacementError,
} from "./remote-table-materialization";

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
    getDataFrameEntry.mockResolvedValue(undefined);
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
    expect(deleteArrowData.mock.invocationCallOrder[0]).toBeLessThan(
      removeDataFrame.mock.invocationCallOrder[0],
    );
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
    expect(removeDataFrame).not.toHaveBeenCalled();
  });

  it("restores the previous link when old row deletion fails", async () => {
    const previousFrameId = "33333333-3333-4333-8333-333333333333" as UUID;
    const previousFields = [field("cleared")];
    getDataTable.mockResolvedValue({
      id: TABLE_ID,
      fields: previousFields,
      dataFrameId: previousFrameId,
      lastFetchedAt: 123,
    });
    getDataFrameEntry.mockResolvedValue({
      id: previousFrameId,
      fieldIds: previousFields.map(({ id }) => id),
      storage: { type: "indexeddb", key: "arrow:old" },
      createdAt: 1,
      name: "Old leads",
    });
    const cleanupError = new Error("cleanup failed");
    deleteArrowData.mockImplementation(async (key: string) => {
      if (key === "arrow:old") throw cleanupError;
    });

    await expect(
      materializeRemoteTable(
        { id: TABLE_ID },
        result([field("cleared")]),
        "Leads",
      ),
    ).rejects.toBeInstanceOf(RemoteTableReplacementError);

    expect(updateDataTable).toHaveBeenLastCalledWith(TABLE_ID, {
      fields: previousFields,
      dataFrameId: previousFrameId,
      lastFetchedAt: 123,
    });
    expect(deleteArrowData).toHaveBeenCalledWith("arrow:new");
    expect(removeDataFrame).toHaveBeenCalledWith(FRAME_ID);
    expect(removeDataFrame).not.toHaveBeenCalledWith(previousFrameId);
  });

  it("keeps the replacement after old rows are deleted", async () => {
    const previousFrameId = "33333333-3333-4333-8333-333333333333" as UUID;
    getDataTable.mockResolvedValue({
      id: TABLE_ID,
      fields: [],
      dataFrameId: previousFrameId,
    });
    getDataFrameEntry.mockResolvedValue({
      id: previousFrameId,
      fieldIds: [],
      storage: { type: "indexeddb", key: "arrow:old" },
      createdAt: 1,
      name: "Old leads",
    });
    const cleanupError = new Error("metadata cleanup failed");
    removeDataFrame.mockRejectedValue(cleanupError);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      materializeRemoteTable(
        { id: TABLE_ID },
        result([field("cleared")]),
        "Leads",
      ),
    ).resolves.toMatchObject({ dataFrameId: FRAME_ID });

    expect(deleteArrowData).toHaveBeenCalledWith("arrow:old");
    expect(removeDataFrame).toHaveBeenCalledWith(previousFrameId);
    expect(consoleError).toHaveBeenCalledWith(
      "[DashFrame] Removed replaced remote rows but not their metadata:",
      cleanupError,
    );
    consoleError.mockRestore();
  });
});

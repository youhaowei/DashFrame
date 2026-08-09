import { setWyStackClient } from "@/wystack/client";
import type { DataFrame, UUID } from "@dashframe/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDataFrame, replaceDataFrame } from "./data-frames";

const { mockDeleteArrowData, mockMutate, mockQuery } = vi.hoisted(() => ({
  mockDeleteArrowData: vi.fn(),
  mockMutate: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("@dashframe/engine-browser", () => ({
  DataFrame: class {},
  QueryBuilder: class {},
  deleteArrowData: mockDeleteArrowData,
}));
vi.mock("@/wystack/api", () => ({
  api: {
    getDataFrameEntry: "getDataFrameEntry",
    updateDataFrameEntry: "updateDataFrameEntry",
  },
}));

const DATA_FRAME_ID = "data-frame-id" as UUID;

describe("replaceDataFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue(undefined);
    mockMutate.mockResolvedValue({ ok: true });
    setWyStackClient({ query: mockQuery, mutate: mockMutate } as never);
  });

  it("clears stale column analysis while replacing frame storage", async () => {
    const replacementFrame = {
      id: DATA_FRAME_ID,
      toJSON: () => ({
        id: DATA_FRAME_ID,
        storage: { type: "indexeddb", key: "replacement-arrow" },
        fieldIds: ["new-field-id" as UUID],
        primaryKey: "new-field-id",
        createdAt: 123,
      }),
    } as DataFrame;

    await replaceDataFrame(DATA_FRAME_ID, replacementFrame, {
      rowCount: 20,
      columnCount: 1,
    });

    expect(mockMutate).toHaveBeenCalledWith("updateDataFrameEntry", {
      id: DATA_FRAME_ID,
      updates: expect.objectContaining({
        storage: { type: "indexeddb", key: "replacement-arrow" },
        fieldIds: ["new-field-id"],
        primaryKey: "new-field-id",
        createdAt: 123,
        rowCount: 20,
        columnCount: 1,
        analysis: null,
      }),
    });
  });

  it("constructs a server reference instead of BrowserDataFrame for file storage", async () => {
    mockQuery.mockResolvedValue({
      id: DATA_FRAME_ID,
      storage: { type: "file", key: DATA_FRAME_ID },
      fieldIds: [],
      createdAt: 123,
      name: "Remote frame",
    });

    const frame = await getDataFrame(DATA_FRAME_ID);

    expect(frame?.getStorageType()).toBe("Server File");
    expect(frame?.toJSON().storage).toEqual({
      type: "file",
      key: DATA_FRAME_ID,
    });
  });
});

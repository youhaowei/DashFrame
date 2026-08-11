import { setWyStackClient } from "@/wystack/client";
import type { UUID } from "@dashframe/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ingestLocalDataFrame, queryDataFrame } from "./data-frames";

const { mockMutate, mockQuery } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("@/wystack/api", () => ({
  api: {
    ingestLocalDataFrame: "ingestLocalDataFrame",
    queryDataFrame: "queryDataFrame",
  },
}));

const DATA_FRAME_ID = "10000000-0000-4000-8000-000000000001" as UUID;
const DATA_TABLE_ID = "10000000-0000-4000-8000-000000000002" as UUID;

describe("server-owned DataFrame access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWyStackClient({ query: mockQuery, mutate: mockMutate } as never);
  });

  it("hands local Arrow bytes to the narrow onboarding mutation", async () => {
    mockMutate.mockResolvedValue({
      dataFrameId: DATA_FRAME_ID,
      rowCount: 2,
      columnCount: 1,
    });

    await ingestLocalDataFrame(DATA_TABLE_ID, new Uint8Array([1, 2, 3]), "id");

    expect(mockMutate).toHaveBeenCalledWith("ingestLocalDataFrame", {
      dataTableId: DATA_TABLE_ID,
      arrowBase64: "AQID",
      primaryKey: "id",
    });
  });

  it("queries rows only through the bounded server frame surface", async () => {
    mockQuery.mockResolvedValue({ status: "ready", rows: [] });

    await queryDataFrame(DATA_FRAME_ID, { offset: 25, limit: 50 });

    expect(mockQuery).toHaveBeenCalledWith("queryDataFrame", {
      dataFrameId: DATA_FRAME_ID,
      offset: 25,
      limit: 50,
    });
  });
});

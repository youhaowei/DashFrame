import type { DataFrameStorage } from "@dashframe/engine";
import type { UUID } from "@dashframe/types";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HostContext, HostDataPlaneRuntime } from "./context";
import { queryDataFrame } from "./data-frame-query";

describe("queryDataFrame", () => {
  it("registers from storage with a streaming-only runtime", async () => {
    const id = "11111111-1111-4111-8111-111111111111" as UUID;
    const row = {
      id,
      storage: { type: "file", key: id },
      fieldIds: ["value-field"],
      analysis: {
        schema: [{ id: "value-field", name: "value", type: "number" }],
      },
      rowCount: 1,
    };
    const storage: DataFrameStorage = {
      save: async () => {},
      load: async () => null,
      delete: async () => {},
      exists: async () => true,
      list: async () => [id],
      getUsage: async () => ({ count: 1 }),
      async *stream() {
        yield new Uint8Array([1, 2, 3]);
      },
    };
    const runtime = {
      queryArrow: vi.fn(async (sql: string) =>
        sql.includes("COUNT(*)")
          ? tableToIPC(tableFromArrays({ count: [1] }))
          : tableToIPC(tableFromArrays({ value: [42] })),
      ),
      registerArrowStream: vi.fn(async (_name, stream) => {
        for await (const _chunk of stream) {
          // Consume the storage stream like the native runtime.
        }
      }),
    } satisfies HostDataPlaneRuntime;
    const ctx = {
      metadata: { getDataFrame: vi.fn(async () => row) },
      dataFrameStorage: storage,
      dataPlaneRuntime: runtime,
    } as unknown as HostContext;

    const result = await queryDataFrame(ctx, { dataFrameId: id });

    expect(result).toMatchObject({
      status: "ready",
      rows: [{ value: 42 }],
      totalCount: 1,
    });
    expect(runtime.registerArrowStream).toHaveBeenCalledOnce();
  });

  describe("when registration fails", () => {
    const id = "22222222-2222-4222-8222-222222222222" as UUID;
    const row = {
      id,
      storage: { type: "file", key: id },
      fieldIds: ["value-field"],
      analysis: {
        schema: [{ id: "value-field", name: "value", type: "number" }],
      },
      rowCount: 1,
    };
    const storage = {
      save: async () => {},
      load: async () => null,
      delete: async () => {},
      exists: async () => true,
      list: async () => [id],
      getUsage: async () => ({ count: 1 }),
      async *stream() {
        // Bytes start flowing, then the frame is revoked mid-load.
        yield new Uint8Array([1, 2, 3]);
        throw new Error("frame bytes are gone");
      },
    } as unknown as DataFrameStorage;

    const contextWith = (getDataFrame: () => Promise<unknown>) =>
      ({
        metadata: { getDataFrame: vi.fn(getDataFrame) },
        dataFrameStorage: storage,
        dataPlaneRuntime: {
          queryArrow: vi.fn(async () => tableToIPC(tableFromArrays({}))),
          registerArrowStream: vi.fn(async (_name, stream) => {
            for await (const _chunk of stream) {
              // Drain like the native runtime, surfacing the storage error.
            }
          }),
          unregisterTable: vi.fn(async () => {}),
        } satisfies HostDataPlaneRuntime,
      }) as unknown as HostContext;

    it("reports a frame revoked mid-registration as FRAME_NOT_FOUND", async () => {
      // The metadata row survives the first read and is gone by the time the
      // registration failure is classified — exactly the delete-during-load
      // race. The sibling Arrow routes call this "not found"; so must this.
      let call = 0;
      const ctx = contextWith(async () => (call++ === 0 ? row : undefined));

      const result = await queryDataFrame(ctx, { dataFrameId: id });

      expect(result).toMatchObject({
        status: "failed",
        code: "FRAME_NOT_FOUND",
      });
    });

    it("still reports a genuine fault on a live frame as QUERY_EXECUTION_FAILED", async () => {
      // Ownership holds throughout, so the failure is a real execution fault
      // and must not be laundered into a not-found.
      const ctx = contextWith(async () => row);

      const result = await queryDataFrame(ctx, { dataFrameId: id });

      expect(result).toMatchObject({
        status: "failed",
        code: "QUERY_EXECUTION_FAILED",
      });
    });
  });
});

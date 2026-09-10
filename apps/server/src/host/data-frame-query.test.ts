import type { DataFrameStorage } from "@dashframe/engine";
import type { UUID } from "@dashframe/types";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HostContext, HostDataPlaneRuntime } from "./context";
import { queryDataFrame } from "./data-frame-query";
import { stubQueryEngine } from "./query-engine.fixture";

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
      ...stubQueryEngine(),
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
      // The native binding is what streams; the hosted one buffers.
      nativeTransfer: true,
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

    const tableName = "df_22222222_2222_4222_8222_222222222222";

    const contextWith = (
      getDataFrame: () => Promise<unknown>,
      unregisterTable: (name: string) => Promise<void> = async () => {},
    ) => {
      const runtime = {
        ...stubQueryEngine(),
        queryArrow: vi.fn(async () => tableToIPC(tableFromArrays({}))),
        registerArrowStream: vi.fn(async (_name, stream) => {
          for await (const _chunk of stream) {
            // Drain like the native runtime, surfacing the storage error.
          }
        }),
        unregisterTable: vi.fn(unregisterTable),
        nativeTransfer: true,
      } satisfies HostDataPlaneRuntime;
      const ctx = {
        metadata: { getDataFrame: vi.fn(getDataFrame) },
        dataFrameStorage: storage,
        dataPlaneRuntime: runtime,
      } as unknown as HostContext;
      return { ctx, runtime };
    };

    it("reports a frame revoked mid-registration as FRAME_NOT_FOUND", async () => {
      // The metadata row survives the first read and is gone by the time the
      // registration failure is classified — exactly the delete-during-load
      // race. The sibling Arrow routes call this "not found"; so must this.
      let call = 0;
      const { ctx, runtime } = contextWith(async () =>
        call++ === 0 ? row : undefined,
      );

      const result = await queryDataFrame(ctx, { dataFrameId: id });

      expect(result).toMatchObject({
        status: "failed",
        code: "FRAME_NOT_FOUND",
      });
      // Pin the cleanup contract, not just the status code: the revoked frame's
      // table must actually be dropped, under its own name.
      expect(runtime.registerArrowStream).toHaveBeenCalledWith(
        tableName,
        expect.anything(),
        undefined,
      );
      expect(runtime.unregisterTable).toHaveBeenCalledWith(tableName);
    });

    it("keeps FRAME_NOT_FOUND when the cleanup itself rejects", async () => {
      // A disposed runtime rejects unregisterTable(). Cleanup is best-effort:
      // its failure must not resurface as an execution fault when the frame is
      // simply gone. HostResourceCleanup owns the durable retry.
      let call = 0;
      const { ctx, runtime } = contextWith(
        async () => (call++ === 0 ? row : undefined),
        async () => {
          throw Object.assign(new Error("disposed"), { name: "AbortError" });
        },
      );

      const result = await queryDataFrame(ctx, { dataFrameId: id });

      expect(result).toMatchObject({
        status: "failed",
        code: "FRAME_NOT_FOUND",
      });
      expect(runtime.unregisterTable).toHaveBeenCalledWith(tableName);
    });

    it("reports a file deleted after exists() but before registration as FRAME_NOT_FOUND", async () => {
      const { ctx, runtime } = contextWith(async () => row);
      const exists = vi
        .spyOn(storage, "exists")
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);

      try {
        const result = await queryDataFrame(ctx, { dataFrameId: id });

        expect(result).toMatchObject({
          status: "failed",
          code: "FRAME_NOT_FOUND",
        });
        expect(runtime.unregisterTable).toHaveBeenCalledWith(tableName);
      } finally {
        exists.mockRestore();
      }
    });

    it("still reports a genuine fault on a live frame as QUERY_EXECUTION_FAILED", async () => {
      // Ownership holds throughout, so the failure is a real execution fault
      // and must not be laundered into a not-found.
      const { ctx } = contextWith(async () => row);

      const result = await queryDataFrame(ctx, { dataFrameId: id });

      expect(result).toMatchObject({
        status: "failed",
        code: "QUERY_EXECUTION_FAILED",
      });
    });
  });
});

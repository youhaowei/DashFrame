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
});

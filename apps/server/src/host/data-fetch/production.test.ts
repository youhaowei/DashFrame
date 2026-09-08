import { describe, expect, it } from "vite-plus/test";

import type { HostContext } from "../context";
import {
  completedProductionReplayScope,
  productionMaterializationScope,
} from "./production";

describe("completed production replay scope", () => {
  it("replaces only generations published by the completed materialization", () => {
    const scope = JSON.stringify([
      "runtime-1",
      { kind: "user", userId: "user" },
      { kind: "saved", insightId: "insight" },
      { baseTableId: "base" },
      [
        ["table", "base", "old-base", 1],
        ["table", "unchanged", "existing-frame", 2],
      ],
    ]);

    const replay = completedProductionReplayScope(scope, {
      sourceGenerations: [
        {
          tableId: "base",
          dataFrameId: "published-base",
          lastFetchedAt: 3,
        },
      ],
    });

    expect(JSON.parse(replay!)[4]).toEqual([
      ["table", "base", "published-base", 3],
      ["table", "unchanged", "existing-frame", 2],
    ]);
  });

  it("matches the scope recomputed after publication", async () => {
    let table = {
      id: "base",
      dataFrameId: "old-frame",
      lastFetchedAt: 1,
    };
    const context = {
      principal: { kind: "user", userId: "user" },
      metadata: { getDataTable: async () => table },
    } as unknown as HostContext;
    const target = { kind: "saved", insightId: "insight" } as const;
    const insight = {
      baseTableId: "base",
      selectedFields: [],
      metrics: [],
    };
    const before = await productionMaterializationScope(
      "runtime-1",
      context,
      target,
      insight,
    );
    const result = {
      sourceGenerations: [
        { tableId: "base", dataFrameId: "new-frame", lastFetchedAt: 2 },
      ],
    };
    table = { id: "base", dataFrameId: "new-frame", lastFetchedAt: 2 };
    const after = await productionMaterializationScope(
      "runtime-1",
      context,
      target,
      insight,
    );

    expect(completedProductionReplayScope(before, result)).toBe(after);
  });

  it("does not replay an explicit refresh", () => {
    const scope = JSON.stringify([
      "runtime-1",
      { kind: "user", userId: "user" },
      { kind: "refresh" },
      { baseTableId: "base" },
      [["table", "base", "old-frame", 1]],
    ]);

    expect(
      completedProductionReplayScope(scope, {
        sourceGenerations: [
          { tableId: "base", dataFrameId: "new-frame", lastFetchedAt: 2 },
        ],
      }),
    ).toBeUndefined();
  });
});

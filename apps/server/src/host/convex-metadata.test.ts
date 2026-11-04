/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import schema from "@dashframe/convex-backend/schema";
import type { LocalConvex } from "@dashframe/convex-local";

import { createHostMetadata } from "./convex-metadata";

const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);

let native: ReturnType<typeof convexTest>;
let metadata: ReturnType<typeof createHostMetadata>;

beforeEach(() => {
  native = convexTest(schema, modules);
  metadata = createHostMetadata(
    {
      query: native.query,
      mutation: native.mutation,
    } as unknown as LocalConvex["internalClient"],
    "w",
  );
});
afterEach(() => {
  vi.useRealTimers();
});

async function seedFrames(count: number, insightId?: string) {
  await native.run(async (ctx) => {
    for (let index = 0; index < count; index++) {
      const id = crypto.randomUUID();
      await ctx.db.insert("dataFrames", {
        workspaceId: "w",
        id,
        revision: 1,
        name: "Frame",
        createdAt: index,
        storage: { type: "file", key: id },
        fieldIds: [],
        ...(insightId ? { insightId } : {}),
      });
    }
  });
}

it("collects every frame across pages past 1,000 rows", async () => {
  const insightId = crypto.randomUUID();
  await seedFrames(1001, insightId);
  await seedFrames(3);
  expect(await metadata.listDataFrames()).toHaveLength(1004);
  const byInsight = await metadata.listDataFramesByInsight(insightId);
  expect(byInsight).toHaveLength(1001);
  expect(byInsight.every((row) => row.insightId === insightId)).toBe(true);
});

it("returns from clearAllData only once every batch of the workspace is gone", async () => {
  // Fake timers never advance, so the backend's own continuation never runs
  // and the adapter's calls are what empties the workspace.
  vi.useFakeTimers();
  await seedFrames(1001);
  await metadata.clearAllData();
  expect(await metadata.listDataFrames()).toEqual([]);
});

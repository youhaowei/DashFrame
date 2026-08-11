import { openArtifactDb, schema } from "@dashframe/server-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PublishMaterialization } from "./materializer";
import { publishMaterialization } from "./publisher";

function materialization(
  target:
    | { kind: "ephemeral" }
    | { kind: "transient" }
    | { kind: "saved"; insightId: string },
) {
  return {
    target,
    sources: [
      {
        source: {
          table: { id: "table", dataSourceId: "source", name: "Source" },
          provenance: {
            connectorKind: "googleAnalytics",
            bindingVersion: "v1",
          },
        },
        frame: {
          id: "source-frame",
          fieldIds: ["field"],
          rowCount: 1,
          schema: [],
        },
      },
    ],
    result: {
      id: "result-frame",
      fieldIds: ["result"],
      rowCount: 2,
      schema: [],
    },
    definitionFingerprint: "fingerprint",
    provenance: { connectorKind: "googleAnalytics", bindingVersion: "v1" },
    fetchedAt: 100,
  } as never;
}

function context(failInsert = false) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const tx = {
    into: () => ({
      insert: async (value: unknown) => {
        inserts.push(value);
        if (failInsert && inserts.length === 2) throw new Error("db");
      },
    }),
    from: () => ({
      where: () => ({
        update: async (value: unknown) => {
          updates.push(value);
        },
      }),
    }),
  };
  return {
    ctx: {
      db: {
        transaction: async (fn: (value: typeof tx) => Promise<void>) => fn(tx),
      },
    } as never,
    inserts,
    updates,
  };
}

describe("publishMaterialization", () => {
  it("inserts new generations, swaps pointers, and retains old generations", async () => {
    const h = context();
    await publishMaterialization(
      h.ctx,
      materialization({ kind: "saved", insightId: "insight" }),
    );
    expect(h.inserts).toHaveLength(2);
    expect(h.inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source-frame" }),
        expect.objectContaining({ id: "result-frame", insightId: "insight" }),
      ]),
    );
    expect(h.updates).toContainEqual({
      dataFrameId: "source-frame",
      lastFetchedAt: new Date(100),
    });
    expect(h.updates).toContainEqual({ insightId: null });
  });

  it("does not attach an ephemeral result to an Insight", async () => {
    const h = context();
    await publishMaterialization(h.ctx, materialization({ kind: "ephemeral" }));
    expect(h.inserts.at(-1)).toEqual(
      expect.not.objectContaining({ insightId: expect.anything() }),
    );
  });

  it("publishes refreshed sources without inserting a transient result", async () => {
    const h = context();
    await publishMaterialization(h.ctx, materialization({ kind: "transient" }));
    expect(h.inserts).toEqual([
      expect.objectContaining({ id: "source-frame" }),
    ]);
    expect(h.updates).toEqual([
      {
        dataFrameId: "source-frame",
        lastFetchedAt: new Date(100),
      },
    ]);
  });

  it("propagates transaction failure for C1 cleanup without deleting old generations", async () => {
    const h = context(true);
    await expect(
      publishMaterialization(
        h.ctx,
        materialization({ kind: "saved", insightId: "insight" }),
      ),
    ).rejects.toThrow("db");
  });

  it("rolls back a real ArtifactDb publication failure without detaching the prior result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashframe-publish-rollback-"));
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    try {
      const sourceId = crypto.randomUUID();
      const tableId = crypto.randomUUID();
      const insightId = crypto.randomUUID();
      const oldId = crypto.randomUUID();
      const collidedResultId = crypto.randomUUID();
      await db.insert(schema.dataSources).values({
        id: sourceId,
        name: "Source",
        kind: "googleAnalytics",
        storage: "live",
        config: {},
        createdBy: { kind: "user" },
      });
      await db.insert(schema.dataTables).values({
        id: tableId,
        dataSourceId: sourceId,
        name: "Table",
        table: "properties/1",
        fields: [],
        metrics: [],
      });
      for (const [id, attached] of [
        [oldId, insightId],
        [collidedResultId, null],
      ] as const) {
        await db.insert(schema.dataFrames).values({
          id,
          storage: { type: "file", key: id },
          fieldIds: [],
          name: "Existing",
          insightId: attached,
        });
      }
      const value = materialization({
        kind: "saved",
        insightId,
      }) as PublishMaterialization;
      value.sources[0]!.source.table = {
        ...value.sources[0]!.source.table,
        id: tableId as never,
        dataSourceId: sourceId as never,
        name: "Table",
      };
      value.sources[0]!.frame.id = crypto.randomUUID() as never;
      value.result.id = collidedResultId;

      await expect(
        publishMaterialization({ db } as never, value),
      ).rejects.toThrow();

      const frames = await db.select().from(schema.dataFrames);
      expect(frames.find((frame) => frame.id === oldId)?.insightId).toBe(
        insightId,
      );
      expect(
        frames.some((frame) => frame.id === value.sources[0]!.frame.id),
      ).toBe(false);
      expect(
        (await db.select().from(schema.dataTables)).find(
          (row) => row.id === tableId,
        )?.dataFrameId,
      ).toBeNull();
    } finally {
      await db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

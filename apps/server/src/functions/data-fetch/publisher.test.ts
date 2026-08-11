import { describe, expect, it } from "vitest";

import { publishMaterialization } from "./publisher";

function materialization(
  target: { kind: "ephemeral" } | { kind: "saved"; insightId: string },
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
        update: async (value: unknown) => void updates.push(value),
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

  it("propagates transaction failure for C1 cleanup without deleting old generations", async () => {
    const h = context(true);
    await expect(
      publishMaterialization(
        h.ctx,
        materialization({ kind: "saved", insightId: "insight" }),
      ),
    ).rejects.toThrow("db");
  });
});

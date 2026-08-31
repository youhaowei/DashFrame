import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { cmd } from "@dashframe/types";
const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
beforeEach(() => {
  t = makeTest();
});
const user = () =>
  t.withIdentity({
    subject: "u",
    workspaceId: "w",
    principalKind: "user",
    userId: "u",
  });
type Publication = FunctionArgs<
  typeof internal.host.publishMaterialization
>["value"];
async function fixture() {
  const sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID(),
    fieldId = crypto.randomUUID();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDataSource", { id: sourceId, name: "Source", type: "csv" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Table",
        table: "t.csv",
        fields: [
          {
            id: fieldId,
            tableId,
            name: "Value",
            columnName: "value",
            type: "number",
          },
        ],
      }),
    ],
  });
  const provenance = { connectorKind: "local", bindingVersion: "v1" },
    columns = [{ id: fieldId, name: "Value", type: "number" }];
  const frame = () => ({
    id: crypto.randomUUID(),
    fieldIds: [fieldId],
    rowCount: 3,
    schema: columns,
  });
  return {
    sources: [
      {
        source: {
          table: {
            id: tableId,
            dataSourceId: sourceId,
            table: "t.csv",
            name: "Table",
          },
          provenance,
        },
        frame: frame(),
      },
    ],
    result: frame(),
    target: { kind: "ephemeral" as const },
    definitionFingerprint: "fingerprint",
    provenance,
    fetchedAt: 123,
  };
}
it("stores metadata-only publication receipts and preserves retry identity", async () => {
  const value = await fixture();
  await t.mutation(internal.host.publishMaterialization, {
    workspaceId: "w",
    value,
  });
  const receipt = await t.query(internal.host.getOperation, {
    workspaceId: "w",
    operationId: `materialize:${value.result.id}`,
  });
  expect(receipt?.request).toEqual(value);
  expect(JSON.stringify(receipt)).not.toMatch(/arrow|sampleValues|dataRows/);
  expect(
    (
      await user().query(api.app.getDataTable, {
        id: value.sources[0]!.source.table.id,
      })
    )?.dataFrameId,
  ).toBe(value.sources[0]!.frame.id);
  const result = await t.query(internal.host.getDataFrame, {
    workspaceId: "w",
    id: value.result.id,
  });
  expect(result?.analysis).toMatchObject({
    schema: value.result.schema,
    lifecycle: { kind: "serverSession" },
  });
  await t.mutation(internal.host.publishMaterialization, {
    workspaceId: "w",
    value,
  });
  expect(await user().query(api.app.listDataFrames, {})).toHaveLength(2);
});
it.each([
  "sourceArrow",
  "largeArrow",
  "sourceFields",
  "tableSamples",
  "frameSamples",
  "schemaSamples",
  "provenanceData",
  "targetData",
])(
  "rejects row data or arbitrary extra metadata at the %s boundary",
  async (slot) => {
    const value = await fixture(),
      item = value.sources[0]!;
    const candidate: unknown =
      slot === "sourceArrow"
        ? {
            ...value,
            sources: [
              { ...item, source: { ...item.source, arrow: { "0": 42 } } },
            ],
          }
        : slot === "largeArrow"
          ? {
              ...value,
              sources: [
                {
                  ...item,
                  source: {
                    ...item.source,
                    arrow: new Uint8Array(1024 * 1024 + 1).buffer,
                  },
                },
              ],
            }
          : slot === "sourceFields"
            ? {
                ...value,
                sources: [
                  {
                    ...item,
                    source: {
                      ...item.source,
                      fields: [{ sampleValues: ["private"] }],
                    },
                  },
                ],
              }
            : slot === "tableSamples"
              ? {
                  ...value,
                  sources: [
                    {
                      ...item,
                      source: {
                        ...item.source,
                        table: {
                          ...item.source.table,
                          sampleValues: ["private"],
                        },
                      },
                    },
                  ],
                }
              : slot === "frameSamples"
                ? {
                    ...value,
                    result: { ...value.result, sampleValues: ["private"] },
                  }
                : slot === "schemaSamples"
                  ? {
                      ...value,
                      result: {
                        ...value.result,
                        schema: [
                          {
                            ...value.result.schema[0]!,
                            sampleValues: ["private"],
                          },
                        ],
                      },
                    }
                  : slot === "provenanceData"
                    ? {
                        ...value,
                        provenance: {
                          ...value.provenance,
                          dataRows: ["private"],
                        },
                      }
                    : {
                        ...value,
                        target: { ...value.target, dataRows: ["private"] },
                      };
    await expect(
      t.mutation(internal.host.publishMaterialization, {
        workspaceId: "w",
        value: candidate as Publication,
      }),
    ).rejects.toThrow();
    expect(await user().query(api.app.listDataFrames, {})).toEqual([]);
    expect(
      await t.query(internal.host.getOperation, {
        workspaceId: "w",
        operationId: `materialize:${value.result.id}`,
      }),
    ).toBeNull();
  },
);
it.each(["deleted", "dataSourceId", "table"])(
  "rejects changed source binding %s without publishing partial frames",
  async (change) => {
    const value = await fixture(),
      binding = value.sources[0]!.source.table;
    await t.run(async (ctx) => {
      const table = await ctx.db
        .query("dataTables")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", "w").eq("id", binding.id),
        )
        .unique();
      if (!table) throw new Error("Missing table");
      if (change === "deleted") await ctx.db.delete(table._id);
      else await ctx.db.patch(table._id, { [change]: "changed" });
    });
    await expect(
      t.mutation(internal.host.publishMaterialization, {
        workspaceId: "w",
        value,
      }),
    ).rejects.toThrow("SOURCE_BINDING_CHANGED");
    expect(await user().query(api.app.listDataFrames, {})).toEqual([]);
    expect(
      await t.query(internal.host.getOperation, {
        workspaceId: "w",
        operationId: `materialize:${value.result.id}`,
      }),
    ).toBeNull();
  },
);
it("publishes transient sources without retaining their intermediate result", async () => {
  const original = await fixture(),
    value = { ...original, target: { kind: "transient" as const } };
  await t.mutation(internal.host.publishMaterialization, {
    workspaceId: "w",
    value,
  });
  expect(
    await t.query(internal.host.getDataFrame, {
      workspaceId: "w",
      id: value.result.id,
    }),
  ).toBeNull();
  expect(await user().query(api.app.listDataFrames, {})).toHaveLength(1);
});
it("rolls back earlier source publication when a later source binding changes", async () => {
  const first = await fixture(),
    second = await fixture(),
    bad = second.sources[0]!.source.table;
  const value = { ...first, sources: [...first.sources, ...second.sources] };
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("dataTables")
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", "w").eq("id", bad.id),
      )
      .unique();
    if (!row) throw new Error("Missing table");
    await ctx.db.patch(row._id, { table: "rebound.csv" });
  });
  await expect(
    t.mutation(internal.host.publishMaterialization, {
      workspaceId: "w",
      value,
    }),
  ).rejects.toThrow("SOURCE_BINDING_CHANGED");
  expect(await user().query(api.app.listDataFrames, {})).toEqual([]);
  expect(
    (
      await user().query(api.app.getDataTable, {
        id: first.sources[0]!.source.table.id,
      })
    )?.dataFrameId,
  ).toBeUndefined();
});
it("moves the saved current-result marker while preserving immutable prior frames", async () => {
  const original = await fixture(),
    insightId = crypto.randomUUID();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateInsight", {
        id: insightId,
        name: "Insight",
        source: {
          sourceType: "dataTable",
          sourceId: original.sources[0]!.source.table.id,
        },
      }),
    ],
  });
  const first = { ...original, target: { kind: "saved" as const, insightId } };
  await t.mutation(internal.host.publishMaterialization, {
    workspaceId: "w",
    value: first,
  });
  const second = {
    ...first,
    sources: [],
    result: { ...first.result, id: crypto.randomUUID() },
    fetchedAt: 124,
  };
  await t.mutation(internal.host.publishMaterialization, {
    workspaceId: "w",
    value: second,
  });
  expect(
    (
      await t.query(internal.host.getDataFrame, {
        workspaceId: "w",
        id: first.result.id,
      })
    )?.analysis,
  ).toMatchObject({ currentInsightResult: false });
  expect(
    (
      await t.query(internal.host.getDataFrame, {
        workspaceId: "w",
        id: second.result.id,
      })
    )?.analysis,
  ).toMatchObject({ currentInsightResult: true });
  expect(
    (await user().query(api.app.getDataFrameByInsight, { insightId }))?.id,
  ).toBe(second.result.id);
});

import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import {
  buildSensitivityUpdate,
  cmd,
  mergeReplacementFields,
  type Field,
} from "@dashframe/types";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
beforeEach(() => {
  t = makeTest();
});
const identity = {
  subject: "u",
  workspaceId: "w",
  principalKind: "user",
  userId: "u",
};
const user = () => t.withIdentity(identity);

const field = (
  id: string,
  tableId: string,
  columnName: string,
  type: Field["type"] = "string",
): Field => ({ id, tableId, name: columnName, columnName, type });

async function seed() {
  const sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID(),
    customerId = crypto.randomUUID(),
    amountId = crypto.randomUUID();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDataSource", { id: sourceId, name: "S", type: "csv" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "T",
        table: "t.csv",
        fields: [
          field(customerId, tableId, "customer"),
          field(amountId, tableId, "amount", "number"),
        ],
      }),
    ],
  });
  return { sourceId, tableId, customerId, amountId };
}

async function storedFields(tableId: string) {
  const table = await user().query(api.app.getDataTable, { id: tableId });
  return table!.fields as Field[];
}

function replacementCommit(
  sourceId: string,
  tableId: string,
  fields: Field[],
  expectedDataFrameId: string | null = null,
) {
  const frameId = crypto.randomUUID(),
    fetchedAt = Date.now();
  return {
    workspaceId: "w",
    operationId: crypto.randomUUID(),
    dataSourceId: sourceId,
    dataTableId: tableId,
    expectedDataFrameId,
    frameRow: {
      id: frameId,
      name: "T",
      storage: { type: "file", key: frameId },
      fieldIds: fields.map((candidate) => candidate.id),
      rowCount: 2,
      columnCount: fields.length,
      lastRefreshedAt: fetchedAt,
    },
    tableUpdate: {
      name: "T",
      table: "t.csv",
      sourceSchema: {
        columns: fields.map((candidate) => ({
          name: candidate.columnName!,
          type: candidate.type,
        })),
        version: 1,
        lastSyncedAt: fetchedAt,
      },
      fields,
      metrics: [],
      dataFrameId: frameId,
      lastFetchedAt: fetchedAt,
    },
  };
}

it("keeps a field marked sensitive between the replacement snapshot and its commit", async () => {
  const { sourceId, tableId, customerId, amountId } = await seed();
  // The importer snapshots the table, parses the file, and merges identities.
  const snapshot = await storedFields(tableId);
  const parsed = [
    field(crypto.randomUUID(), tableId, "customer"),
    field(crypto.randomUUID(), tableId, "amount", "number"),
  ];
  const merged = mergeReplacementFields(parsed, snapshot);
  expect(merged.map((candidate) => candidate.id)).toEqual([
    customerId,
    amountId,
  ]);
  expect(merged[0]!.sensitivity).toBeUndefined();

  // Another client classifies the column before the import commits. The
  // frame pointer does not move, so the replacement's fence still passes.
  const marking = buildSensitivityUpdate("sensitive");
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("UpdateField", {
        nodeId: tableId,
        fieldId: customerId,
        updates: marking,
      }),
    ],
  });

  const commit = replacementCommit(sourceId, tableId, merged);
  await t.mutation(internal.host.commitImportedFrame, commit);

  const committed = await storedFields(tableId);
  expect(committed).toEqual([{ ...merged[0], ...marking }, merged[1]]);
  const table = await user().query(api.app.getDataTable, { id: tableId });
  expect(table?.dataFrameId).toBe(commit.frameRow.id);
});

it("commits replacement fields unchanged when no stored field is sensitive", async () => {
  const { sourceId, tableId, customerId } = await seed();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("UpdateField", {
        nodeId: tableId,
        fieldId: customerId,
        updates: buildSensitivityUpdate("cleared"),
      }),
    ],
  });
  // A cleared column is re-verified after its data changes, and a new column
  // arrives unclassified: the commit must not invent a marker for either.
  const merged = mergeReplacementFields(
    [
      field(crypto.randomUUID(), tableId, "customer"),
      field(crypto.randomUUID(), tableId, "region"),
    ],
    await storedFields(tableId),
  );
  expect(merged[0]).toMatchObject({
    id: customerId,
    sensitivity: "unclassified",
  });

  await t.mutation(
    internal.host.commitImportedFrame,
    replacementCommit(sourceId, tableId, merged),
  );

  expect(await storedFields(tableId)).toEqual(merged);
});

it("resets a snapshot's sensitive marker that was withdrawn before the commit", async () => {
  const { sourceId, tableId, customerId } = await seed();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("UpdateField", {
        nodeId: tableId,
        fieldId: customerId,
        updates: buildSensitivityUpdate("sensitive"),
      }),
    ],
  });
  const merged = mergeReplacementFields(
    [
      field(crypto.randomUUID(), tableId, "customer"),
      field(crypto.randomUUID(), tableId, "amount", "number"),
    ],
    await storedFields(tableId),
  );
  expect(merged[0]).toMatchObject({ id: customerId, sensitivity: "sensitive" });

  // The user resets the classification while the import is in flight. The
  // replacement carries new data, so the stale marker does not come back.
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("UpdateField", {
        nodeId: tableId,
        fieldId: customerId,
        updates: buildSensitivityUpdate("unclassified"),
      }),
    ],
  });
  await t.mutation(
    internal.host.commitImportedFrame,
    replacementCommit(sourceId, tableId, merged),
  );

  expect((await storedFields(tableId))[0]).toEqual({
    ...merged[0],
    ...buildSensitivityUpdate("unclassified"),
  });
});

it("leaves a connector's freshly identified reviewed fields to the review", async () => {
  const { sourceId, tableId, customerId } = await seed();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("UpdateField", {
        nodeId: tableId,
        fieldId: customerId,
        updates: buildSensitivityUpdate("sensitive"),
      }),
    ],
  });
  // A connector snapshot commits new field ids after the user reviewed every
  // column as cleared for this import. Those are not the stored fields, so
  // the review's decision stands.
  const fields = [
    {
      ...field(crypto.randomUUID(), tableId, "customer"),
      ...buildSensitivityUpdate("cleared"),
    },
    {
      ...field(crypto.randomUUID(), tableId, "amount", "number"),
      ...buildSensitivityUpdate("cleared"),
    },
  ];

  await t.mutation(
    internal.host.commitImportedFrame,
    replacementCommit(sourceId, tableId, fields),
  );

  expect(await storedFields(tableId)).toEqual(fields);
});

it("still reports a malformed replacement field through the stored-state diagnostic", async () => {
  const { sourceId, tableId, customerId } = await seed();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("UpdateField", {
        nodeId: tableId,
        fieldId: customerId,
        updates: buildSensitivityUpdate("sensitive"),
      }),
    ],
  });
  const commit = replacementCommit(sourceId, tableId, [
    field(crypto.randomUUID(), tableId, "customer"),
  ]);
  await expect(
    t.mutation(internal.host.commitImportedFrame, {
      ...commit,
      tableUpdate: { ...commit.tableUpdate, fields: [null] },
    }),
  ).rejects.toThrow("Imported table");
});

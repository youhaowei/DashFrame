import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { cmd } from "@dashframe/types";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { Graph } from "../convex/graph";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
const uuid = () => crypto.randomUUID();

let t: ReturnType<typeof makeTest>;
let user: ReturnType<typeof t.withIdentity>;

beforeEach(() => {
  t = makeTest();
  user = t.withIdentity({
    subject: "user",
    workspaceId: "workspace",
    principalKind: "user",
    userId: "user",
  });
});

async function seedVisualization() {
  return (await seedChain()).visualizationId;
}
async function seedChain() {
  const sourceId = uuid();
  const tableId = uuid();
  const insightId = uuid();
  const visualizationId = uuid();

  await user.mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDataSource", {
        id: sourceId,
        type: "csv",
        name: "Source",
      }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Table",
        table: "sales.csv",
      }),
      cmd("CreateInsight", {
        id: insightId,
        name: "Revenue insight",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
      cmd("CreateVisualization", {
        id: visualizationId,
        name: "Revenue by region",
        insightId,
        visualizationType: "barY",
        spec: {},
      }),
    ],
  });

  return { sourceId, tableId, insightId, visualizationId };
}

it("projects only the visualization field changed by a rename", async () => {
  const visualizationId = await seedVisualization();

  const diff = await user.query(api.app.previewDiff, {
    commands: [
      cmd("RenameNode", {
        id: visualizationId,
        name: "Revenue by region (QA draft)",
      }),
    ],
  });

  expect(diff.directNodes).toHaveLength(1);
  expect(diff.directNodes[0]?.proposedDefinition).toEqual({
    name: "Revenue by region (QA draft)",
  });
});

it("keeps the empty proposed definition for a no-op", async () => {
  const visualizationId = await seedVisualization();

  const diff = await user.query(api.app.previewDiff, {
    commands: [
      cmd("RenameNode", { id: visualizationId, name: "Revenue by region" }),
    ],
  });

  expect(diff.directNodes).toHaveLength(1);
  expect(diff.directNodes[0]).toMatchObject({
    change: "noop",
    proposedDefinition: {},
  });
});

it("keeps the deletion marker for a deleted artifact", async () => {
  const visualizationId = await seedVisualization();

  const diff = await user.query(api.app.previewDiff, {
    commands: [cmd("DeleteNode", { id: visualizationId })],
  });

  expect(diff.directNodes).toHaveLength(1);
  expect(diff.directNodes[0]).toMatchObject({
    change: "update",
    proposedDefinition: { deleted: true },
  });
});

// The downstream walk reads the graph as it stood before the commands ran, so
// a delete cascade reports the rows it removes as orphaned instead of walking
// a graph they have already left.
it("reports the cascade of a deleted data source as orphaned downstream nodes", async () => {
  const { sourceId, tableId, insightId, visualizationId } = await seedChain();

  const diff = await user.query(api.app.previewDiff, {
    commands: [cmd("DeleteNode", { id: sourceId })],
  });

  expect(diff.directNodes).toHaveLength(1);
  expect(diff.directNodes[0]).toMatchObject({
    nodeId: sourceId,
    proposedDefinition: { deleted: true },
  });
  expect(
    diff.affectedDownstream
      .map((n) => [n.kind, n.nodeId, n.flag])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
  ).toEqual(
    [
      ["dataTable", tableId, "orphaned"],
      ["insight", insightId, "orphaned"],
      ["visualization", visualizationId, "orphaned"],
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
  );
});

it("reports a data frame linked through a deleted parent artifact", async () => {
  const sourceId = uuid();
  const frameId = uuid();
  await user.mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDataSource", {
        id: sourceId,
        type: "csv",
        name: "Source",
      }),
    ],
  });
  await t.run((ctx) =>
    ctx.db.insert("dataFrames", {
      workspaceId: "workspace",
      id: frameId,
      revision: 1,
      name: "Derived frame",
      createdAt: Date.now(),
      parentArtifactId: sourceId,
      storage: { type: "file", key: frameId },
      fieldIds: [],
    }),
  );

  const diff = await user.query(api.app.previewDiff, {
    commands: [cmd("DeleteNode", { id: sourceId })],
  });

  expect(diff.affectedDownstream).toContainEqual({
    nodeId: frameId,
    kind: "dataFrame",
    name: "Derived frame",
    edge: "parentArtifact",
    via: { kind: "dataSource", id: sourceId },
    flag: "orphaned",
  });
});

it("rejects an unselected data frame scan after a recovery list read", async () => {
  await t.run(async (ctx) => {
    const graph = new Graph(ctx, "workspace");
    expect(await graph.list("dataFrames")).toEqual([]);
    await expect(graph.scan("dataFrames")).rejects.toThrow(
      "Data frames are never scanned whole; select them through an index",
    );
  });
});

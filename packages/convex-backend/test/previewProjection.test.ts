import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { cmd } from "@dashframe/types";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { describeCommand } from "../convex/preview";
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

it("uses report-hierarchy terminology in deterministic intent summaries", () => {
  expect(
    describeCommand(
      cmd("SetInsightMetrics", {
        id: uuid(),
        metrics: [],
      }),
    ),
  ).toEqual({
    command: "SetInsightMetrics",
    summary: "Update metrics",
  });

  expect(
    describeCommand(
      cmd("SetInsightRuntimeControls", {
        id: uuid(),
        runtimeControls: undefined,
      }),
    ),
  ).toEqual({
    command: "SetInsightRuntimeControls",
    summary: "Update question controls",
  });

  expect(
    describeCommand(
      cmd("SetChartType", {
        id: uuid(),
        visualizationType: "barX",
      }),
    ),
  ).toEqual({
    command: "SetChartType",
    summary: "Change chart type to Horizontal bar",
  });
});

it("attributes an atomic metric replacement preview to its insight", async () => {
  const { insightId } = await seedChain();
  const diff = await user.query(api.app.previewDiff, {
    commands: [cmd("SetInsightMetrics", { id: insightId, metrics: [] })],
  });
  expect(diff.error).toBeUndefined();
  expect(diff.directNodes).toEqual([
    expect.objectContaining({ nodeId: insightId, kind: "insight" }),
  ]);
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

async function placeOnReport(visualizationId: string) {
  const reportId = uuid();
  await user.mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDashboard", { id: reportId, name: "Report" }),
      cmd("AddDashboardItem", {
        dashboardId: reportId,
        item: {
          id: uuid(),
          type: "visualization",
          visualizationId,
          x: 0,
          y: 0,
          width: 4,
          height: 3,
        },
      }),
    ],
  });
  return reportId;
}
const downstreamFlags = (diff: {
  affectedDownstream: { kind: string; nodeId: string; flag: string }[];
}) =>
  diff.affectedDownstream
    .map((n) => [n.kind, n.nodeId, n.flag])
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
const sorted = (rows: string[][]) =>
  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));

// Deleting a chart takes its tiles off its reports in the same commit, so the
// report is edited rather than left pointing at a chart that is gone.
it("flags a report as losing tiles when a chart on it is deleted", async () => {
  const visualizationId = await seedVisualization();
  const reportId = await placeOnReport(visualizationId);
  const textReportId = uuid();
  await user.mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDashboard", { id: textReportId, name: "Notes" }),
      cmd("AddDashboardItem", {
        dashboardId: textReportId,
        item: {
          id: uuid(),
          type: "markdown",
          content: "Keep this note",
          visualizationId,
          x: 0,
          y: 0,
          width: 4,
          height: 3,
        },
      }),
    ],
  });

  const diff = await user.query(api.app.previewDiff, {
    commands: [cmd("DeleteNode", { id: visualizationId })],
  });

  expect(downstreamFlags(diff)).toEqual([
    ["dashboard", reportId, "losesTiles"],
  ]);
  expect(diff.tablesWritten).toContain("dashboards");
});

// The report is a direct node here, so it gets no downstream flag: its own
// entry has to show the tiles the chart delete takes off it.
it("shows the removed tiles on a report the same batch edits directly", async () => {
  const visualizationId = await seedVisualization();
  const reportId = await placeOnReport(visualizationId);

  const diff = await user.query(api.app.previewDiff, {
    commands: [
      cmd("RenameNode", { id: reportId, name: "Renamed" }),
      cmd("DeleteNode", { id: visualizationId }),
    ],
  });

  const report = diff.directNodes.find((n) => n.nodeId === reportId)!;
  expect(report).toMatchObject({
    change: "update",
    proposedDefinition: { name: "Renamed", items: [] },
  });
  expect(downstreamFlags(diff)).toEqual([]);
});

it("flags a report as losing tiles when its chart goes with a deleted insight", async () => {
  const { insightId, visualizationId } = await seedChain();
  const reportId = await placeOnReport(visualizationId);

  const diff = await user.query(api.app.previewDiff, {
    commands: [cmd("DeleteNode", { id: insightId })],
  });

  expect(downstreamFlags(diff)).toEqual(
    sorted([
      ["visualization", visualizationId, "orphaned"],
      ["dashboard", reportId, "losesTiles"],
    ]),
  );
});

it("keeps a report orphaned or stale when its chart is not deleted", async () => {
  const { sourceId, tableId, insightId, visualizationId } = await seedChain();
  const reportId = await placeOnReport(visualizationId);

  // Deleting the source leaves the insight and its chart in place.
  const deleted = await user.query(api.app.previewDiff, {
    commands: [cmd("DeleteNode", { id: sourceId })],
  });
  expect(downstreamFlags(deleted)).toEqual(
    sorted([
      ["dataTable", tableId, "orphaned"],
      ["insight", insightId, "orphaned"],
      ["visualization", visualizationId, "orphaned"],
      ["dashboard", reportId, "orphaned"],
    ]),
  );

  const renamed = await user.query(api.app.previewDiff, {
    commands: [cmd("RenameNode", { id: visualizationId, name: "Renamed" })],
  });
  expect(downstreamFlags(renamed)).toEqual([["dashboard", reportId, "stale"]]);
});

it("previews an ifUnused delete of a node in use as no change", async () => {
  const { insightId } = await seedChain();

  const diff = await user.query(api.app.previewDiff, {
    commands: [cmd("DeleteNode", { id: insightId, ifUnused: true })],
  });

  expect(diff.error).toBeUndefined();
  expect(diff.directNodes).toEqual([
    expect.objectContaining({
      nodeId: insightId,
      kind: "insight",
      change: "noop",
    }),
  ]);
  expect(diff.affectedDownstream).toEqual([]);
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

it("rejects an unselected data frame scan after a whole-table list read", async () => {
  await t.run(async (ctx) => {
    const graph = new Graph(ctx, "workspace");
    expect(await graph.list("dataFrames")).toEqual([]);
    await expect(graph.scan("dataFrames")).rejects.toThrow(
      "Data frames are never scanned whole; select them through an index",
    );
  });
});

it.each(["source", "table"])(
  "previews all frames removed by a %s deletion",
  async (kind) => {
    const { sourceId, tableId } = await seedChain();
    const sourceFrame = uuid(),
      definitionFrame = uuid(),
      linkedFrame = uuid();
    const targetFrames =
      kind === "source"
        ? [sourceFrame, definitionFrame, linkedFrame]
        : [definitionFrame, linkedFrame];
    await t.run(async (ctx) => {
      for (const [id, owner] of [
        [sourceFrame, { sourceId }],
        [definitionFrame, { definitionId: tableId }],
        [linkedFrame, {}],
      ] as const) {
        await ctx.db.insert("dataFrames", {
          workspaceId: "workspace",
          id,
          revision: 1,
          name: id,
          createdAt: Date.now(),
          storage: { type: "file", key: id },
          fieldIds: [],
          ...owner,
        });
      }
      const table = await ctx.db
        .query("dataTables")
        .filter((q) => q.eq(q.field("id"), tableId))
        .unique();
      await ctx.db.patch(table!._id, { dataFrameId: linkedFrame });
    });
    const commands = [
      cmd("DeleteNode", { id: kind === "source" ? sourceId : tableId }),
    ];
    const diff = await user.query(api.app.previewDiff, { commands });
    const previewFrames = diff.affectedDownstream.filter(
      (node) => node.kind === "dataFrame",
    );
    expect(previewFrames.map((node) => node.nodeId).sort()).toEqual(
      [...targetFrames].sort(),
    );
    expect(previewFrames.every((node) => node.flag === "orphaned")).toBe(true);
    await user.mutation(api.app.commitBatch, { commands });
    const remaining = await t.run((ctx) =>
      ctx.db.query("dataFrames").collect(),
    );
    expect(
      [sourceFrame, definitionFrame, linkedFrame]
        .filter((id) => !remaining.some((row) => row.id === id))
        .sort(),
    ).toEqual([...targetFrames].sort());
  },
);

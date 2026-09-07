import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { cmd } from "@dashframe/types";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { describeCommand } from "../convex/preview";

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

async function seedVisualization() {
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

  return visualizationId;
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

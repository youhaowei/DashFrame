import { openArtifactDb } from "@dashframe/server-core";
import type { Principal } from "@wystack/identity";
import type { WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { functions } from "../functions";
import { wy } from "../wystack";

const servicePrincipal: Principal = {
  kind: "service",
  credentialId: "credential-1",
};

const id = "00000000-0000-4000-8000-000000000001";
const relatedId = "00000000-0000-4000-8000-000000000002";

const commandCalls = [
  ["getOrCreateDataSource", { id, type: "csv", name: "Source" }],
  ["createDataSource", { id, type: "csv", name: "Source" }],
  ["setDataSourceConfig", { id }],
  [
    "createDataTable",
    { id, dataSourceId: relatedId, name: "Table", table: "table.csv" },
  ],
  ["setDataTableSchema", { id, sourceSchema: {} }],
  ["refreshDataTableCmd", { id, dataFrameId: relatedId }],
  ["addField", { nodeId: id, field: {} }],
  ["updateField", { nodeId: id, fieldId: relatedId, updates: {} }],
  ["removeField", { nodeId: id, fieldId: relatedId }],
  ["addMetric", { nodeId: id, metric: {} }],
  ["updateMetric", { nodeId: id, metricId: relatedId, updates: {} }],
  ["removeMetric", { nodeId: id, metricId: relatedId }],
  [
    "createInsightCmd",
    {
      id,
      name: "Insight",
      source: { sourceType: "dataTable", sourceId: relatedId },
    },
  ],
  [
    "setInsightSource",
    { id, source: { sourceType: "dataTable", sourceId: relatedId } },
  ],
  ["selectFields", { id, fieldIds: [] }],
  ["setInsightFilter", { id, filters: [] }],
  ["setInsightSort", { id, sorts: [] }],
  ["addJoin", { id, join: {} }],
  ["updateJoin", { id, joinIndex: 0, updates: {} }],
  ["removeJoin", { id, joinIndex: 0 }],
  [
    "createVisualizationCmd",
    {
      id,
      name: "Visualization",
      insightId: relatedId,
      visualizationType: "bar",
      spec: {},
    },
  ],
  ["setChartType", { id, visualizationType: "line" }],
  ["setChartEncoding", { id, encoding: {} }],
  ["createDashboardCmd", { id, name: "Dashboard" }],
  ["addDashboardItemCmd", { dashboardId: id, item: {} }],
  [
    "updateDashboardItemCmd",
    { dashboardId: id, itemId: relatedId, updates: {} },
  ],
  ["setDashboardLayout", { dashboardId: id, items: [] }],
  ["removeDashboardItemCmd", { dashboardId: id, itemId: relatedId }],
  [
    "fanOutDashboardItemsCmd",
    {
      dashboardId: id,
      sourceItemId: relatedId,
      field: "region",
      placements: [],
    },
  ],
  ["renameNode", { id, name: "Renamed" }],
  ["deleteNode", { id }],
] as const;

describe("command procedure authorization", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-command-auth-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a service principal on all 31 direct command procedures", async () => {
    expect(commandCalls).toHaveLength(31);

    for (const [path, args] of commandCalls) {
      await expect(
        app.call(path, args, { principal: servicePrincipal }),
        path,
      ).rejects.toMatchObject({ name: "PermissionDeniedError" });
    }
  });
});

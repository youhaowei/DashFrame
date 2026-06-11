/**
 * PreviewDiff builder (YW-124) tests.
 *
 * These exercise the Layer-B wrapper THROUGH the real engine and a real
 * artifact DB: a batch of typed commands run in preview mode, the result read as
 * the artifact-grouped `PreviewDiff`. They assert the contracts YW-124 freezes —
 * direct-node grouping with intent + before/after, downstream fan-out across
 * EACH implicit DAG edge (FK, JSON-IR, parentArtifactId), rollback leaving
 * canonical untouched, and the split-tier rule that compute slots stay unfilled
 * server-side.
 *
 * Downstream artifacts (insights / dataFrames / visualizations / dashboards) are
 * seeded directly through the Drizzle handle — there are no vocabulary commands
 * for them yet (YW-123+), and the DAG walk reads canonical state regardless of
 * how it got there. Direct nodes are driven through `cmd(...)` like commit does.
 */
import { openArtifactDb, schema } from "@dashframe/server-core";
import { createWyStack, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";
import { cmd } from "./commands";
import { buildPreviewDiff } from "./preview-diff";

const {
  dataSources,
  dataTables,
  dataFrames,
  insights,
  visualizations,
  dashboards,
} = schema;

const PROV = { kind: "user" as const };

describe("PreviewDiff builder", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-preview-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await createWyStack({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function id(): string {
    return crypto.randomUUID();
  }

  async function preview(...commands: ReturnType<typeof cmd>[]) {
    return buildPreviewDiff(app, db, commands);
  }

  // --- direct seeding helpers (no vocabulary commands for these yet) ---------

  async function seedSource(
    overrides: Partial<typeof dataSources.$inferInsert> = {},
  ) {
    const sourceId = id();
    await db.insert(dataSources).values({
      id: sourceId,
      name: "Src",
      kind: "csv",
      storage: "live",
      config: {},
      createdBy: PROV,
      ...overrides,
    });
    return sourceId;
  }

  async function seedTable(
    dataSourceId: string,
    overrides: Partial<typeof dataTables.$inferInsert> = {},
  ) {
    const tableId = id();
    await db.insert(dataTables).values({
      id: tableId,
      dataSourceId,
      name: "Tbl",
      table: "t.csv",
      fields: [],
      metrics: [],
      ...overrides,
    });
    return tableId;
  }

  async function seedInsight(
    definition: unknown,
    overrides: Partial<typeof insights.$inferInsert> = {},
  ) {
    const insightId = id();
    await db.insert(insights).values({
      id: insightId,
      name: "Ins",
      definition,
      createdBy: PROV,
      ...overrides,
    });
    return insightId;
  }

  async function seedFrame(insightId: string) {
    const frameId = id();
    await db.insert(dataFrames).values({
      id: frameId,
      storage: {},
      fieldIds: [],
      name: "Frame",
      insightId,
    });
    return frameId;
  }

  async function seedVisualization(
    insightId: string,
    overrides: Partial<typeof visualizations.$inferInsert> = {},
  ) {
    const vizId = id();
    await db.insert(visualizations).values({
      id: vizId,
      insightId,
      name: "Viz",
      chartType: "bar",
      encoding: {},
      createdBy: PROV,
      ...overrides,
    });
    return vizId;
  }

  async function seedDashboard(layout: unknown) {
    const dashId = id();
    await db.insert(dashboards).values({
      id: dashId,
      name: "Dash",
      layout,
      createdBy: PROV,
    });
    return dashId;
  }

  // --------------------------------------------------------------------------
  // Direct-node diff
  // --------------------------------------------------------------------------

  describe("direct nodes", () => {
    it("should group a single create command as one direct node with its intent", async () => {
      const sourceId = id();
      const diff = await preview(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "Sales" }),
      );

      expect(diff.mode).toBe("preview");
      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.nodeId).toBe(sourceId);
      expect(node.kind).toBe("dataSource");
      expect(node.change).toBe("create");
      expect(node.before).toBeNull();
      expect(node.intent).toEqual([
        { command: "CreateDataSource", summary: 'Create data source "Sales"' },
      ]);
      // The proposed slice is the command args (the proposed value), not a read.
      expect(node.proposedDefinition).toMatchObject({
        name: "Sales",
        type: "csv",
      });
    });

    it("should merge multiple commands on one node into a single grouped node, intents in order", async () => {
      const sourceId = id();
      const diff = await preview(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "Orig" }),
        cmd("SetDataSourceConfig", { id: sourceId, apiKey: "k" }),
        cmd("RenameNode", { id: sourceId, name: "Renamed" }),
      );

      // One node despite three commands — artifact-grouped, not a flat log.
      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.nodeId).toBe(sourceId);
      expect(node.intent.map((i) => i.command)).toEqual([
        "CreateDataSource",
        "SetDataSourceConfig",
        "RenameNode",
      ]);
    });

    it("should populate before from canonical state for an update on an existing node", async () => {
      // Seed a source canonically, then preview a rename of it.
      const sourceId = await seedSource({ name: "Before Name" });
      const diff = await preview(
        cmd("RenameNode", { id: sourceId, name: "After Name" }),
      );

      const node = diff.directNodes[0]!;
      expect(node.change).toBe("update");
      expect(node.kind).toBe("dataSource"); // polymorphic rename resolved to the real kind
      expect((node.before as { name?: string }).name).toBe("Before Name");
      expect(node.proposedDefinition).toMatchObject({ name: "After Name" });
    });

    it("should resolve a polymorphic RenameNode to the dataTable kind when the id is a table", async () => {
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId, { name: "T1" });
      const diff = await preview(
        cmd("RenameNode", { id: tableId, name: "T2" }),
      );

      expect(diff.directNodes[0]!.kind).toBe("dataTable");
    });

    it("should keep update + before when repeated get-or-creates hit an existing row", async () => {
      // Idempotent import batch: the source already exists canonically and the
      // batch get-or-creates it twice. Neither command mints the node — the
      // grouped node must stay an update with the canonical before-slice, on
      // the first command (descriptor says create, row exists) AND on the
      // repeat (the merge path must not regress it to create/null).
      const sourceId = await seedSource({ name: "Existing" });
      const diff = await preview(
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "X" }),
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "X" }),
      );

      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("update");
      expect((node.before as { name?: string }).name).toBe("Existing");
      expect(node.intent).toHaveLength(2);
      // The handler ignores args when the row exists (existing row wins), so
      // the stale name/type must not masquerade as a proposed change.
      expect(node.proposedDefinition).toEqual({});
    });
  });

  // --------------------------------------------------------------------------
  // Downstream fan-out — one test per implicit DAG edge
  // --------------------------------------------------------------------------

  describe("downstream fan-out", () => {
    it("should fan out dataSource -> dataTable via the FK edge", async () => {
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);

      const diff = await preview(
        cmd("RenameNode", { id: sourceId, name: "X" }),
      );

      const downstream = diff.affectedDownstream;
      const table = downstream.find((n) => n.nodeId === tableId);
      expect(table).toMatchObject({
        kind: "dataTable",
        edge: "dataSource->dataTable",
        via: sourceId,
      });
    });

    it("should fan out dataTable -> insight via the definition baseTableId ref", async () => {
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      const insightId = await seedInsight({ baseTableId: tableId });

      const diff = await preview(cmd("RenameNode", { id: tableId, name: "X" }));

      const ins = diff.affectedDownstream.find((n) => n.nodeId === insightId);
      expect(ins).toMatchObject({
        kind: "insight",
        edge: "dataTable->insight",
        via: tableId,
      });
    });

    it("should fan out dataTable -> insight via a joins[].rightTableId ref", async () => {
      const sourceId = await seedSource();
      const baseTableId = await seedTable(sourceId);
      const joinTableId = await seedTable(sourceId);
      const insightId = await seedInsight({
        baseTableId,
        joins: [
          {
            type: "inner",
            rightTableId: joinTableId,
            leftKey: "a",
            rightKey: "b",
          },
        ],
      });

      // Touch the JOIN table — the insight references it only through joins[].
      const diff = await preview(
        cmd("RenameNode", { id: joinTableId, name: "X" }),
      );

      const ins = diff.affectedDownstream.find((n) => n.nodeId === insightId);
      expect(ins).toMatchObject({
        edge: "dataTable->insight",
        via: joinTableId,
      });
    });

    it("should fan out insight -> dataFrame via the FK edge, flagged stale", async () => {
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      const insightId = await seedInsight({ baseTableId: tableId });
      const frameId = await seedFrame(insightId);

      const diff = await preview(
        cmd("RenameNode", { id: insightId, name: "X" }),
      );

      const frame = diff.affectedDownstream.find((n) => n.nodeId === frameId);
      expect(frame).toMatchObject({
        kind: "dataFrame",
        edge: "insight->dataFrame",
        flag: "stale",
      });
    });

    it("should fan out insight -> visualization via the FK edge", async () => {
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      const insightId = await seedInsight({ baseTableId: tableId });
      const vizId = await seedVisualization(insightId);

      const diff = await preview(
        cmd("RenameNode", { id: insightId, name: "X" }),
      );

      const viz = diff.affectedDownstream.find((n) => n.nodeId === vizId);
      expect(viz).toMatchObject({
        kind: "visualization",
        edge: "insight->visualization",
      });
    });

    it("should fan out visualization -> dashboard via the layout visualizationId ref", async () => {
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      const insightId = await seedInsight({ baseTableId: tableId });
      const vizId = await seedVisualization(insightId);
      const dashId = await seedDashboard([
        {
          id: id(),
          type: "visualization",
          visualizationId: vizId,
          x: 0,
          y: 0,
          width: 4,
          height: 4,
        },
      ]);

      // Touch the insight — fan-out must reach the dashboard transitively
      // (insight -> visualization -> dashboard).
      const diff = await preview(
        cmd("RenameNode", { id: insightId, name: "X" }),
      );

      const dash = diff.affectedDownstream.find((n) => n.nodeId === dashId);
      expect(dash).toMatchObject({
        kind: "dashboard",
        edge: "visualization->dashboard",
      });
    });

    it("should walk the full chain source -> table -> insight -> viz -> dashboard from one touched source", async () => {
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      const insightId = await seedInsight({ baseTableId: tableId });
      const vizId = await seedVisualization(insightId);
      const dashId = await seedDashboard([
        {
          id: id(),
          type: "visualization",
          visualizationId: vizId,
          x: 0,
          y: 0,
          width: 4,
          height: 4,
        },
      ]);

      const diff = await preview(
        cmd("RenameNode", { id: sourceId, name: "X" }),
      );

      const ids = diff.affectedDownstream.map((n) => n.nodeId);
      expect(ids).toEqual(
        expect.arrayContaining([tableId, insightId, vizId, dashId]),
      );
    });

    it("should fan out via the cross-cutting parentArtifactId edge", async () => {
      // An insight whose parent points at a touched source — lineage that is not
      // a typed FK edge. parentArtifactId is the cross-cutting pointer.
      const sourceId = await seedSource();
      const childInsightId = await seedInsight(
        { baseTableId: id() },
        { parentArtifactId: sourceId },
      );

      const diff = await preview(
        cmd("RenameNode", { id: sourceId, name: "X" }),
      );

      const child = diff.affectedDownstream.find(
        (n) => n.nodeId === childInsightId,
      );
      expect(child).toMatchObject({ edge: "parentArtifact", via: sourceId });
    });

    it("should flag each downstream node once even when reached by two paths", async () => {
      // Two visualizations (vizId1, vizId2) both reference the same insight and
      // both appear in the same dashboard layout. Touching the insight fans out to
      // vizId1 (insight->visualization) and then vizId1->dashboard, then vizId2
      // (insight->visualization) and then vizId2->dashboard again. The
      // visited-set must emit the dashboard exactly once.
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      const insightId = await seedInsight({ baseTableId: tableId });
      const vizId1 = await seedVisualization(insightId);
      const vizId2 = await seedVisualization(insightId);
      const dashId = await seedDashboard([
        {
          id: id(),
          type: "visualization",
          visualizationId: vizId1,
          x: 0,
          y: 0,
          width: 4,
          height: 4,
        },
        {
          id: id(),
          type: "visualization",
          visualizationId: vizId2,
          x: 4,
          y: 0,
          width: 4,
          height: 4,
        },
      ]);

      const diff = await preview(
        cmd("RenameNode", { id: insightId, name: "X" }),
      );

      const dashHits = diff.affectedDownstream.filter(
        (n) => n.nodeId === dashId,
      );
      expect(dashHits).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Rollback / canonical isolation
  // --------------------------------------------------------------------------

  describe("rollback leaves canonical untouched", () => {
    it("should persist nothing — a previewed create is not in the canonical table", async () => {
      const sourceId = id();
      await preview(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      );

      const rows = (await db.select().from(dataSources)).filter(
        (r) => r.id === sourceId,
      );
      expect(rows).toHaveLength(0);
    });

    it("should echo tablesWritten — what a commit WOULD have invalidated", async () => {
      const sourceId = id();
      const diff = await preview(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      );
      expect(diff.tablesWritten).toContain("data_sources");
    });

    it("should not mutate an existing node's canonical row when previewing an update", async () => {
      const sourceId = await seedSource({ name: "Keep" });
      await preview(cmd("RenameNode", { id: sourceId, name: "Changed" }));

      const [row] = (await db.select().from(dataSources)).filter(
        (r) => r.id === sourceId,
      );
      expect(row?.name).toBe("Keep");
    });
  });

  // --------------------------------------------------------------------------
  // Split-tier: compute slots stay unfilled server-side
  // --------------------------------------------------------------------------

  describe("split-tier compute deferral", () => {
    it("should leave compute undefined on every direct node (filled client-side, not here)", async () => {
      const sourceId = id();
      const tableId = id();
      const diff = await preview(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
      );

      expect(diff.directNodes.length).toBeGreaterThan(0);
      for (const node of diff.directNodes) {
        expect(node.compute).toBeUndefined();
      }
    });

    it("should never embed row data in affectedDownstream (flagged only)", async () => {
      const sourceId = await seedSource();
      await seedTable(sourceId);

      const diff = await preview(
        cmd("RenameNode", { id: sourceId, name: "X" }),
      );

      expect(diff.affectedDownstream.length).toBeGreaterThan(0);
      // Each downstream entry is a flag, not a payload — assert the exact key set.
      for (const node of diff.affectedDownstream) {
        expect(Object.keys(node).sort()).toEqual(
          ["edge", "flag", "kind", "nodeId", "via"].sort(),
        );
      }
    });
  });
});

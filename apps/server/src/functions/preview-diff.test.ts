/**
 * PreviewDiff builder tests.
 *
 * These exercise the Layer-B wrapper THROUGH the real engine and a real
 * artifact DB: a batch of typed commands run in preview mode, the result read as
 * the artifact-grouped `PreviewDiff`. They assert the preview-diff contracts —
 * direct-node grouping with intent + before/after, downstream fan-out across
 * EACH implicit DAG edge (FK, JSON-IR, parentArtifactId), rollback leaving
 * canonical untouched, and the split-tier rule that compute slots stay unfilled
 * server-side.
 *
 * Downstream artifacts (insights / dataFrames / visualizations / dashboards) are
 * seeded directly through the Drizzle handle — vocabulary commands for those
 * artifact types are out of scope here, and the DAG walk reads canonical state
 * regardless of how it got there. Direct nodes are driven through `cmd(...)` like
 * commit does.
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

    it("should resolve a polymorphic field/metric command to the insight kind when nodeId is an Insight (read the handler result, not the descriptor)", async () => {
      // Regression: field/metric descriptors hard-coded kind "dataTable", so an
      // AddMetric whose nodeId is an Insight grouped under `dataTable:<insightId>`
      // with a missing before-slice and seeded the downstream walk from the wrong
      // kind. The handler now reports target.kind; the builder reads it.
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      const insightId = await seedInsight({
        baseTableId: tableId,
        selectedFields: [],
        metrics: [],
      });

      const diff = await preview(
        cmd("AddMetric", {
          nodeId: insightId,
          metric: {
            id: id(),
            name: "Total",
            sourceTable: tableId,
            aggregation: "sum",
          },
        }),
      );

      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.kind).toBe("insight");
      // The before-slice is the canonical Insight row, not null/mislabeled.
      expect((node.before as { id?: string })?.id).toBe(insightId);
    });

    it("should resolve a polymorphic DeleteNode to the visualization kind when the id is a visualization (read the handler result)", async () => {
      // Regression: DeleteNode descriptor hard-coded kind "dataTable", so a
      // previewed delete of a Visualization read the wrong before-slice and seeded
      // the walk from `dataTable:<id>`. The handler now reports deleted.kind.
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      const insightId = await seedInsight({ baseTableId: tableId });
      const vizId = await seedVisualization(insightId);

      const diff = await preview(cmd("DeleteNode", { id: vizId }));

      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.kind).toBe("visualization");
      expect((node.before as { id?: string })?.id).toBe(vizId);
    });

    it("should keep noop + before when repeated get-or-creates hit an existing row", async () => {
      // Idempotent import batch: the source already exists canonically and the
      // batch get-or-creates it twice. Neither command mints OR mutates the node
      // — both writes nothing — so the grouped node is `noop`, carrying the
      // canonical before-slice, on the first command (descriptor says create,
      // row exists) AND on the repeat (the merge path must not regress it).
      const sourceId = await seedSource({ name: "Existing" });
      const diff = await preview(
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "X" }),
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "X" }),
      );

      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("noop");
      expect((node.before as { name?: string }).name).toBe("Existing");
      expect(node.intent).toHaveLength(2);
      // The handler ignores args when the row exists (existing row wins), so
      // the stale name/type must not masquerade as a proposed change.
      expect(node.proposedDefinition).toEqual({});
    });
  });

  // --------------------------------------------------------------------------
  // Node-merge state machine — one test per (accumulated × effect) cell.
  //
  // The merge logic took four consecutive review findings; this matrix pins
  // every cell of the transition table so a regression in any one is caught.
  // Accumulated state ∈ {absent (first contact), create, update, noop};
  // command effect ∈ {create, update, noop}.
  // --------------------------------------------------------------------------

  describe("node-merge state machine", () => {
    // ---- ABSENT row: first contact establishes the node ----

    it("absent + create: declared-create on an absent row mints (before=null, args proposed)", async () => {
      const sourceId = id();
      const diff = await preview(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "New" }),
      );
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("create");
      expect(node.before).toBeNull();
      expect(node.proposedDefinition).toMatchObject({ name: "New" });
    });

    it("absent + update: declared-update on an existing row mutates (before=canon, args proposed)", async () => {
      const sourceId = await seedSource({ name: "Before" });
      const diff = await preview(
        cmd("RenameNode", { id: sourceId, name: "After" }),
      );
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("update");
      expect((node.before as { name?: string }).name).toBe("Before");
      expect(node.proposedDefinition).toMatchObject({ name: "After" });
    });

    it("absent + noop: get-or-create hitting an existing row writes nothing (before=canon, proposed=∅)", async () => {
      const sourceId = await seedSource({ name: "Existing" });
      const diff = await preview(
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "X" }),
      );
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("noop");
      expect((node.before as { name?: string }).name).toBe("Existing");
      expect(node.proposedDefinition).toEqual({});
    });

    // ---- CREATE accumulated: node minted earlier in the batch ----

    it("create + create: a get-or-create after an in-batch create stays create, no before regression", async () => {
      // CreateDataSource mints the row in-batch; a following GetOrCreate on the
      // same id resolves to noop (row exists in batch) and must not wipe state.
      const sourceId = id();
      const diff = await preview(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "Fresh" }),
        cmd("GetOrCreateDataSource", {
          id: sourceId,
          type: "csv",
          name: "Ignored",
        }),
      );
      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("create");
      expect(node.before).toBeNull();
      // The idempotent get contributes nothing; the create's args survive.
      expect(node.proposedDefinition).toMatchObject({ name: "Fresh" });
    });

    it("create + update: a create then an update on the same fresh node stays create, args merge", async () => {
      const sourceId = id();
      const diff = await preview(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "Fresh" }),
        cmd("RenameNode", { id: sourceId, name: "Renamed" }),
      );
      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("create");
      expect(node.before).toBeNull();
      expect(node.proposedDefinition).toMatchObject({ name: "Renamed" });
    });

    // ---- UPDATE accumulated: existing canonical row, mutated earlier ----

    it("update + update: two updates on one existing node merge args, stay update", async () => {
      const sourceId = await seedSource({ name: "Before" });
      const diff = await preview(
        cmd("SetDataSourceConfig", { id: sourceId, apiKey: "k" }),
        cmd("RenameNode", { id: sourceId, name: "After" }),
      );
      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("update");
      expect((node.before as { name?: string }).name).toBe("Before");
      expect(node.proposedDefinition).toMatchObject({
        apiKey: "k",
        name: "After",
      });
    });

    it("update + noop: an update then an idempotent get on an existing node stays update", async () => {
      const sourceId = await seedSource({ name: "Before" });
      const diff = await preview(
        cmd("RenameNode", { id: sourceId, name: "After" }),
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "X" }),
      );
      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("update");
      expect((node.before as { name?: string }).name).toBe("Before");
      // The genuine update's args survive; the get contributes nothing.
      expect(node.proposedDefinition).toMatchObject({ name: "After" });
    });

    // ---- NOOP accumulated: existing row, only get-or-creates so far ----

    it("noop + update: a real update after an idempotent get upgrades the node to update", async () => {
      const sourceId = await seedSource({ name: "Before" });
      const diff = await preview(
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "X" }),
        cmd("RenameNode", { id: sourceId, name: "After" }),
      );
      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("update");
      expect((node.before as { name?: string }).name).toBe("Before");
      // Only the genuine update contributes; the get's args stay out.
      expect(node.proposedDefinition).toEqual({ id: sourceId, name: "After" });
    });

    it("noop + noop: repeated get-or-creates on an existing row stay noop with empty proposal", async () => {
      const sourceId = await seedSource({ name: "Existing" });
      const diff = await preview(
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "A" }),
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "B" }),
      );
      expect(diff.directNodes).toHaveLength(1);
      const node = diff.directNodes[0]!;
      expect(node.change).toBe("noop");
      expect(node.proposedDefinition).toEqual({});
    });

    // ---- node identity: the `${kind}:${id}` key, not the id alone ----

    it("two kinds sharing one client id stay two distinct nodes (no cross-kind merge)", async () => {
      // PKs are per table, so a batch may legitimately mint a dataSource AND a
      // dataTable under the same client-supplied UUID. A fixed-kind command must
      // use its DESCRIPTOR kind — the table create must not collapse into the
      // source node as a noop and vanish from the preview.
      const sharedId = id();
      const diff = await preview(
        cmd("CreateDataSource", { id: sharedId, type: "csv", name: "Src" }),
        cmd("CreateDataTable", {
          id: sharedId,
          dataSourceId: sharedId,
          name: "Tbl",
          table: "t.csv",
        }),
      );

      expect(diff.directNodes).toHaveLength(2);
      const source = diff.directNodes.find((n) => n.kind === "dataSource")!;
      const table = diff.directNodes.find((n) => n.kind === "dataTable")!;
      expect(source.change).toBe("create");
      expect(table.change).toBe("create");
      // The table's proposed args survive — a real create, not a noop merge.
      expect(table.proposedDefinition).toMatchObject({
        name: "Tbl",
        table: "t.csv",
      });
    });

    it("via.kind disambiguates the direct root when two artifacts share a UUID and a downstream node hangs off exactly one of them", async () => {
      // This is the Codex P2 finding (PRRT_kwDOQKlCpM6I8-JO on PR #54):
      // a batch mints CreateDataSource(X) + CreateDataTable(X). A downstream
      // insight references the dataTable (not the dataSource). With via: UUID
      // the renderer could not tell which direct node owns the blast radius;
      // via: { kind, id } makes it unambiguous.
      const sharedId = id();
      const insightId = id();
      // Seed a canonical insight that references sharedId as its baseTableId so
      // the DAG walk finds it as downstream of the dataTable direct node.
      await db.insert(insights).values({
        id: insightId,
        name: "InsightUnderTable",
        definition: { baseTableId: sharedId },
        createdBy: PROV,
      });

      const diff = await preview(
        cmd("CreateDataSource", { id: sharedId, type: "csv", name: "Src" }),
        cmd("CreateDataTable", {
          id: sharedId,
          dataSourceId: sharedId,
          name: "Tbl",
          table: "t.csv",
        }),
      );

      // The insight must be in affectedDownstream and attributed to the
      // dataTable direct node — not the dataSource.
      const insightHit = diff.affectedDownstream.find(
        (n) => n.nodeId === insightId,
      );
      expect(insightHit).toBeDefined();
      expect(insightHit!.edge).toBe("dataTable->insight");
      // via.kind must be "dataTable" so the renderer resolves the correct root.
      expect(insightHit!.via).toEqual({ kind: "dataTable", id: sharedId });
      // Sanity: must NOT point at the dataSource which also carries sharedId.
      expect(insightHit!.via.kind).not.toBe("dataSource");
    });
  });

  // --------------------------------------------------------------------------
  // No-op batches contribute zero blast radius (finding #4 — PRRT_kwDOQKlCpM6I4_6X)
  // --------------------------------------------------------------------------

  describe("no-op nodes are excluded from the downstream walk", () => {
    it("an idempotent GetOrCreateDataSource for an existing source flags nothing downstream", async () => {
      // The source exists with a table + insight under it. A pure get-or-create
      // for that existing source writes nothing — so NOTHING under it is stale
      // or recompute. The blast radius for this no-op must be empty.
      const sourceId = await seedSource({ name: "Existing" });
      await seedTable(sourceId);
      const tableId = await seedTable(sourceId);
      await seedInsight({ baseTableId: tableId });

      const diff = await preview(
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "X" }),
      );

      // The source is still shown (transparency) as a no-op...
      expect(diff.directNodes).toHaveLength(1);
      expect(diff.directNodes[0]!.change).toBe("noop");
      // ...but contributes zero downstream flags.
      const fromSource = diff.affectedDownstream.filter(
        (n) => n.via.id === sourceId,
      );
      expect(fromSource).toEqual([]);
      expect(diff.affectedDownstream).toEqual([]);
    });

    it("a no-op source alongside a real change still flags the real change's downstream", async () => {
      // Mixed batch: one source is an idempotent no-op; a SECOND, different
      // source is genuinely renamed. Only the renamed source's subtree fans out.
      const noopSourceId = await seedSource({ name: "NoOp" });
      await seedTable(noopSourceId); // would be falsely flagged if noop walked

      const changedSourceId = await seedSource({ name: "Changed" });
      const changedTableId = await seedTable(changedSourceId);

      const diff = await preview(
        cmd("GetOrCreateDataSource", {
          id: noopSourceId,
          type: "csv",
          name: "X",
        }),
        cmd("RenameNode", { id: changedSourceId, name: "Renamed" }),
      );

      const viaNoOp = diff.affectedDownstream.filter(
        (n) => n.via.id === noopSourceId,
      );
      expect(viaNoOp).toEqual([]);
      const changedTable = diff.affectedDownstream.find(
        (n) => n.nodeId === changedTableId,
      );
      expect(changedTable).toMatchObject({
        edge: "dataSource->dataTable",
        via: { kind: "dataSource", id: changedSourceId },
      });
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
        via: { kind: "dataSource", id: sourceId },
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
        via: { kind: "dataTable", id: tableId },
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
        via: { kind: "dataTable", id: joinTableId },
      });
    });

    it("should fan out insight -> insight via the composition baseTableId ref (Insight-on-Insight)", async () => {
      // Regression: when Insight B sources Insight A, B stores A's id in
      // baseTableId, but the walk had only a `dataTable->insight` edge — no
      // `insight->insight`. Previewing a change to A would not surface B (or B's
      // downstream visualizations/dashboards), so a user could publish without
      // seeing the full blast radius of the composition path.
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      const insightAId = await seedInsight({
        baseTableId: tableId,
        source: { sourceType: "dataTable", sourceId: tableId },
      });
      // Insight B sources Insight A (composition): baseTableId carries A's id.
      const insightBId = await seedInsight({
        baseTableId: insightAId,
        source: { sourceType: "insight", sourceId: insightAId },
      });
      const vizBId = await seedVisualization(insightBId);

      // Touch A — the walk must reach B via insight->insight, then B's viz.
      const diff = await preview(
        cmd("RenameNode", { id: insightAId, name: "X" }),
      );

      const insB = diff.affectedDownstream.find((n) => n.nodeId === insightBId);
      expect(insB).toMatchObject({
        kind: "insight",
        edge: "insight->insight",
        via: insightAId,
      });
      // Transitive fan-out continues past B to B's own visualization.
      const vizB = diff.affectedDownstream.find((n) => n.nodeId === vizBId);
      expect(vizB).toMatchObject({
        kind: "visualization",
        edge: "insight->visualization",
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
      expect(child).toMatchObject({
        edge: "parentArtifact",
        via: { kind: "dataSource", id: sourceId },
      });
    });

    it("descendants of an upgraded node walk with the upgraded via/edge, not the stale one", async () => {
      // Regression for the stale-provenance bug (PRRT_kwDOQKlCpM6I6IKg):
      //
      // Setup: a batch touches BOTH a source and a table. The insight is
      // reachable via TWO paths:
      //   weak:   source -> (parentArtifactId) -> insight   (flag: stale)
      //   strong: table  -> (baseTableId)      -> insight   (flag: recompute)
      //
      // The insight's dataFrame is downstream of the insight only.
      //
      // BFS visits the source first (earlier in `direct`), emits the insight
      // via the weak (parentArtifact / stale) path and enqueues it. Then it
      // visits the table, reaches the insight via the stronger path (recompute)
      // and upgrades the emitted entry's flag/edge/via.
      //
      // Bug: the frontier entry for the insight was enqueued with the OLD via
      // (sourceId). When dequeued, `current.via` was stale even though the
      // emitted entry had been upgraded. The insight's descendants (dataFrame)
      // therefore walked with the wrong via.
      //
      // Fix: frontier carries identifiers only; via is read from viaOf at
      // dequeue time, so descendants always see the post-upgrade provenance.
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId);
      // Insight reachable weak (parentArtifactId→source) AND strong (baseTableId→table).
      const insightId = await seedInsight(
        { baseTableId: tableId },
        { parentArtifactId: sourceId },
      );
      const frameId = await seedFrame(insightId);

      // Touch BOTH source and table so BFS sees both paths to the insight.
      const diff = await preview(
        cmd("RenameNode", { id: sourceId, name: "S2" }),
        cmd("RenameNode", { id: tableId, name: "T2" }),
      );

      // The insight must be flagged with the STRONGER path (baseTableId→table).
      const insightHit = diff.affectedDownstream.find(
        (n) => n.nodeId === insightId,
      );
      expect(insightHit).toBeDefined();
      expect(insightHit!.flag).toBe("recompute");
      expect(insightHit!.edge).toBe("dataTable->insight");
      expect(insightHit!.via).toEqual({ kind: "dataTable", id: tableId });

      // The dataFrame is downstream of the insight. Its via must propagate the
      // UPGRADED insight provenance (the tableId that delivered the strongest
      // path to the insight), not the stale sourceId from before the upgrade.
      // The bug: the frontier entry for the insight carried via=sourceId (stale)
      // even after the emitted entry was upgraded to via=tableId; the dataFrame
      // was therefore emitted with via=sourceId instead of via=tableId.
      const frameHit = diff.affectedDownstream.find(
        (n) => n.nodeId === frameId,
      );
      expect(frameHit).toBeDefined();
      expect(frameHit!.via).toEqual({ kind: "dataTable", id: tableId });
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

  // --------------------------------------------------------------------------
  // RenameNode kind resolution (terminal fix — read the handler, #64)
  //
  // These scenarios all turned on which artifact a polymorphic RenameNode
  // resolves to. Every prior round tried to RE-DERIVE that from canonical and/or
  // in-batch lookups and diverged from the real handler. The terminal fix has the
  // handler REPORT its resolution (`result.renamed`); the preview reads it. These
  // tests keep passing — now by construction — and guard the read.
  //
  //   Scenario: id X exists canonically as a dataTable. The batch contains
  //   CreateDataSource({id: X}) followed by RenameNode({id: X}). The handler
  //   probes dataTables first → renames the dataTable; the preview reads that.
  // --------------------------------------------------------------------------

  describe("RenameNode kind resolution reads the handler (#64)", () => {
    it("attaches rename to the canonical dataTable kind even when an earlier batch command registered the same id as dataSource", async () => {
      // X exists in canonical as a dataTable (seeded before the batch).
      const sourceId = await seedSource();
      const tableId = await seedTable(sourceId, { name: "CanonicalTable" });

      // Batch: CreateDataSource({id: tableId}) — registers tableId as "dataSource"
      // in idToKind — then RenameNode({id: tableId}). The fix must resolve the
      // rename to "dataTable" (canonical) not "dataSource" (stale in-batch entry).
      const diff = await preview(
        cmd("CreateDataSource", {
          id: tableId,
          type: "csv",
          name: "WrongKind",
        }),
        cmd("RenameNode", { id: tableId, name: "NewName" }),
      );

      // The rename must attach to the CANONICAL kind (dataTable), not the stale
      // in-batch registration from CreateDataSource.
      const renameNode = diff.directNodes.find(
        (n) => n.nodeId === tableId && n.kind === "dataTable",
      );
      expect(renameNode).toBeDefined();
      expect(renameNode!.kind).toBe("dataTable");
      // The rename intent must be on the dataTable node.
      const renameIntent = renameNode!.intent.find(
        (i) => i.command === "RenameNode",
      );
      expect(renameIntent).toBeDefined();

      // Downstream walk must fan out from the dataTable (not dataSource).
      // There is an insight that references this table via baseTableId — it
      // must appear in affectedDownstream via the dataTable->insight edge.
      const insightId = await seedInsight({ baseTableId: tableId });
      const diff2 = await preview(
        cmd("CreateDataSource", {
          id: tableId,
          type: "csv",
          name: "WrongKind",
        }),
        cmd("RenameNode", { id: tableId, name: "NewName" }),
      );
      const insightHit = diff2.affectedDownstream.find(
        (n) => n.nodeId === insightId,
      );
      expect(insightHit).toMatchObject({
        kind: "insight",
        edge: "dataTable->insight",
      });
    });

    it("still resolves rename to an in-batch-created id when no canonical row exists (create-then-rename)", async () => {
      // The fix must not break the original in-batch use case: a fresh id minted
      // by CreateDataSource in the batch, then renamed in the same batch.
      const freshId = id();
      const diff = await preview(
        cmd("CreateDataSource", { id: freshId, type: "csv", name: "Fresh" }),
        cmd("RenameNode", { id: freshId, name: "Renamed" }),
      );

      // freshId is in-batch-only; the handler renames the dataSource it minted
      // and reports kind "dataSource" — the preview reads that.
      const node = diff.directNodes.find((n) => n.nodeId === freshId);
      expect(node).toBeDefined();
      expect(node!.kind).toBe("dataSource");
      expect(diff.directNodes).toHaveLength(1); // merged into one node
    });
  });

  // --------------------------------------------------------------------------
  // Preview-then-commit equivalence (Fix 3)
  //
  // This is the load-bearing contract: preview tells the truth. For every
  // directNode that preview marks "create" or "update", the committed row's
  // actual state must match the proposedDefinition for the keys preview claimed.
  // For every node preview marks "noop", the canonical row must be byte-identical
  // before and after commit. Nothing commit changed must be absent from preview.
  // --------------------------------------------------------------------------

  describe("preview-then-commit equivalence", () => {
    // Import applyCommands lazily (same pattern as commands.test.ts).
    let applyCommands: typeof import("@wystack/server").applyCommands;
    beforeEach(async () => {
      ({ applyCommands } = await import("@wystack/server"));
    });

    it("proposed definitions in preview match the committed row state for a representative batch", async () => {
      // Representative batch: GetOrCreate (hits existing — noop), CreateDataTable
      // (genuine mint), RenameNode (update on existing source), AddField (update).
      const existingSourceId = await seedSource({ name: "Existing" });

      const newSourceId = id();
      const newTableId = id();

      const batch = [
        // noop: source already exists
        cmd("GetOrCreateDataSource", {
          id: existingSourceId,
          type: "csv",
          name: "IgnoredName",
        }),
        // create: fresh source
        cmd("CreateDataSource", {
          id: newSourceId,
          type: "csv",
          name: "NewSource",
        }),
        // create: fresh table
        cmd("CreateDataTable", {
          id: newTableId,
          dataSourceId: newSourceId,
          name: "NewTable",
          table: "new.csv",
        }),
        // update: rename the existing source
        cmd("RenameNode", { id: existingSourceId, name: "RenamedSource" }),
      ] as ReturnType<typeof cmd>[];

      // 1. Preview — capture the diff.
      const diff = await buildPreviewDiff(app, db, batch);

      // Basic shape assertions.
      // After the rename, existingSource is no longer noop — it gets renamed.
      // GetOrCreate is the first command (noop), RenameNode is the second (update).
      // They merge into one node; the final change is "update" (noop+update=update).
      const existingNode = diff.directNodes.find(
        (n) => n.nodeId === existingSourceId,
      );
      expect(existingNode).toBeDefined();
      // noop + update merges to update
      expect(existingNode!.change).toBe("update");

      const newSourceNode = diff.directNodes.find(
        (n) => n.nodeId === newSourceId,
      );
      expect(newSourceNode).toBeDefined();
      expect(newSourceNode!.change).toBe("create");
      expect(newSourceNode!.proposedDefinition).toMatchObject({
        name: "NewSource",
      });

      const newTableNode = diff.directNodes.find(
        (n) => n.nodeId === newTableId,
      );
      expect(newTableNode).toBeDefined();
      expect(newTableNode!.change).toBe("create");
      expect(newTableNode!.proposedDefinition).toMatchObject({
        name: "NewTable",
        table: "new.csv",
      });

      // 2. Commit the same batch against the same DB (preview rolled it back).
      await applyCommands(app, batch, { mode: "commit" });

      // 3. Equivalence: read committed rows and compare to proposedDefinition.
      const sources = await db.select().from(dataSources);
      const tables = await db.select().from(dataTables);

      // existingSource: preview said "update" with name="RenamedSource"
      const committedExisting = sources.find((r) => r.id === existingSourceId);
      expect(committedExisting).toBeDefined();
      expect(committedExisting!.name).toBe(
        existingNode!.proposedDefinition.name,
      );

      // newSource: preview said "create" with name="NewSource"
      const committedNewSource = sources.find((r) => r.id === newSourceId);
      expect(committedNewSource).toBeDefined();
      expect(committedNewSource!.name).toBe(
        newSourceNode!.proposedDefinition.name,
      );

      // newTable: preview said "create" with name="NewTable", table="new.csv"
      const committedNewTable = tables.find((r) => r.id === newTableId);
      expect(committedNewTable).toBeDefined();
      expect(committedNewTable!.name).toBe(
        newTableNode!.proposedDefinition.name,
      );
      expect(committedNewTable!.table).toBe(
        newTableNode!.proposedDefinition.table,
      );

      // Noop check: existingSource canonical state before preview was "Existing".
      // After the merged update (rename) the committed row is "RenamedSource",
      // which preview correctly declared as the proposed value. The original "before"
      // slice must have captured the pre-batch name.
      expect((existingNode!.before as { name?: string }).name).toBe("Existing");

      // Nothing commit changed is absent from preview's directNodes.
      // All three touched ids must appear in directNodes.
      const previewedIds = diff.directNodes.map((n) => n.nodeId);
      expect(previewedIds).toContain(existingSourceId);
      expect(previewedIds).toContain(newSourceId);
      expect(previewedIds).toContain(newTableId);
    });

    it("preview kind resolution matches publish when both kinds share a colliding in-batch-only id (dataTable probe-order)", async () => {
      // Regression: a batch that creates BOTH a dataTable and a dataSource under
      // the same colliding id, then renames via that id. The renameNode handler
      // probes dataTables before dataSources; the preview fallback must match
      // that probe order when the id is invisible in canonical (in-batch-only).
      //
      // This is the class of divergence that prior rounds missed: the last-writer
      // idToKind approach returned "dataSource" (if CreateDataSource came last)
      // but the real handler would rename the dataTable (#64).
      const collidingId = id();
      const existingSourceId2 = id();

      // The dataTable is created first, then the dataSource under the same id.
      // The handler finds the dataTable first (probe order: dataTables first).
      const batch = [
        cmd("CreateDataSource", {
          id: existingSourceId2,
          type: "csv",
          name: "RefSource",
        }),
        cmd("CreateDataTable", {
          id: collidingId,
          dataSourceId: existingSourceId2,
          name: "CollidingTable",
          table: "t.csv",
        }),
        cmd("CreateDataSource", {
          id: collidingId,
          type: "csv",
          name: "CollidingSource",
        }),
        // RenameNode on collidingId: handler finds the dataTable first.
        cmd("RenameNode", { id: collidingId, name: "RenamedCollider" }),
      ] as ReturnType<typeof cmd>[];

      // 1. Preview — what kind does the preview think the rename targets?
      const diff = await buildPreviewDiff(app, db, batch);

      // The rename node for collidingId must resolve to "dataTable" (same as
      // the renameNode handler which probes dataTables before dataSources).
      const renameNode = diff.directNodes.find(
        (n) => n.nodeId === collidingId && n.kind === "dataTable",
      );
      expect(renameNode).toBeDefined();
      expect(renameNode!.kind).toBe("dataTable");

      // 2. Commit the same batch.
      await applyCommands(app, batch, { mode: "commit" });

      // 3. Equivalence: the renameNode handler must have renamed the dataTable,
      //    not the dataSource — confirming preview matches publish.
      const tables = await db.select().from(dataTables);
      const sources = await db.select().from(dataSources);
      const committedTable = tables.find((r) => r.id === collidingId);
      const committedSource = sources.find((r) => r.id === collidingId);

      // The dataTable was renamed (handler found it first).
      expect(committedTable).toBeDefined();
      expect(committedTable!.name).toBe("RenamedCollider");
      // The dataSource keeps its original name (handler short-circuited after
      // finding the dataTable).
      expect(committedSource).toBeDefined();
      expect(committedSource!.name).toBe("CollidingSource");

      // Preview must agree: the rename node's proposedDefinition carries the
      // final name for the dataTable kind, not the dataSource kind.
      expect(renameNode!.proposedDefinition).toMatchObject({
        name: "RenamedCollider",
      });
    });

    it("preview reads handler resolution for a mixed canonical-source + in-batch-table collision (#64)", async () => {
      // The terminal case every mirroring round lost (public issue #64): id X
      // exists CANONICALLY as a dataSource; the batch creates a dataTable under
      // the same X, then renames X. The renameNode handler probes the LIVE tx —
      // dataTables (the in-batch one) BEFORE dataSources (the canonical one) —
      // so publish renames the dataTable. A preview that re-derived from separate
      // canonical/in-batch lookups stopped at the canonical dataSource and
      // diverged. Reading the handler's reported resolution makes preview agree
      // by construction; this test guards the plumbing.
      const collidingId = await seedSource({ name: "CanonicalSource" });

      const batch = [
        cmd("CreateDataTable", {
          id: collidingId,
          dataSourceId: collidingId,
          name: "InBatchTable",
          table: "t.csv",
        }),
        cmd("RenameNode", { id: collidingId, name: "RenamedTarget" }),
      ] as ReturnType<typeof cmd>[];

      // 1. Preview — the rename must attach to the dataTable kind (handler order),
      //    NOT the canonical dataSource.
      const diff = await buildPreviewDiff(app, db, batch);
      const renameTable = diff.directNodes.find(
        (n) => n.nodeId === collidingId && n.kind === "dataTable",
      );
      expect(renameTable).toBeDefined();
      expect(renameTable!.intent.some((i) => i.command === "RenameNode")).toBe(
        true,
      );
      expect(renameTable!.proposedDefinition).toMatchObject({
        name: "RenamedTarget",
      });
      // The canonical dataSource node must NOT carry the rename intent.
      const sourceNode = diff.directNodes.find(
        (n) => n.nodeId === collidingId && n.kind === "dataSource",
      );
      if (sourceNode) {
        expect(sourceNode.intent.some((i) => i.command === "RenameNode")).toBe(
          false,
        );
      }

      // 2. Commit the same batch — confirm the handler renamed the in-batch
      //    dataTable and left the canonical dataSource untouched.
      await applyCommands(app, batch, { mode: "commit" });
      const tables = await db.select().from(dataTables);
      const sources = await db.select().from(dataSources);
      expect(tables.find((r) => r.id === collidingId)?.name).toBe(
        "RenamedTarget",
      );
      expect(sources.find((r) => r.id === collidingId)?.name).toBe(
        "CanonicalSource",
      );
    });
  });

  // --------------------------------------------------------------------------
  // Cheap contract tests (Fix 4)
  // --------------------------------------------------------------------------

  describe("contract: empty batch and idempotent re-preview", () => {
    it("empty batch produces all-empty diff without throwing", async () => {
      const diff = await buildPreviewDiff(app, db, []);

      expect(diff.mode).toBe("preview");
      expect(diff.directNodes).toEqual([]);
      expect(diff.affectedDownstream).toEqual([]);
      // tablesWritten may be empty but must not throw
      expect(Array.isArray(diff.tablesWritten)).toBe(true);
    });

    it("same batch previewed twice against the same canonical state produces deeply equal diffs", async () => {
      const sourceId = await seedSource({ name: "Stable" });
      await seedTable(sourceId); // creates a downstream node so affectedDownstream is non-empty

      const batch = [
        cmd("RenameNode", { id: sourceId, name: "Renamed" }),
      ] as ReturnType<typeof cmd>[];

      const diff1 = await buildPreviewDiff(app, db, batch);
      const diff2 = await buildPreviewDiff(app, db, batch);

      // Deep equality — idempotent re-preview produces identical metadata.
      expect(diff2.directNodes).toEqual(diff1.directNodes);
      expect(diff2.affectedDownstream).toEqual(diff1.affectedDownstream);
      expect(diff2.tablesWritten).toEqual(diff1.tablesWritten);
      expect(diff2.mode).toBe(diff1.mode);
    });
  });
});

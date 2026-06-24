/**
 * Assistant read host — the resolver against the REAL server seam.
 *
 * The read.test.ts in @dashframe/assistant proves the resolver + floor logic
 * against a fake reader. THIS test proves the load-bearing INTEGRATION the fake
 * cannot: the host adapter dispatching real reads through the WyStack app's
 * server seam, against a real PGlite DB, with the real draft overlay and the
 * real Field.sensitivity classification.
 *
 * Contracts under test:
 *   - DRAFT OVERLAY: a draft-scoped reader sees an insight created INSIDE a
 *     draft; a canonical reader does NOT. Structure reads route through the
 *     withDraftSeam, never raw DB.
 *   - INHERIT-SOURCE (real sensitivity): readData masks (profiles-only) when a
 *     real Field.sensitivity on the source is "sensitive"; does not mask a
 *     fully-cleared source. Structure is never gated.
 *   - NEIGHBORHOOD/TRAVERSAL over real artifacts.
 */

import { createReadTools, type DataReadResult } from "@dashframe/assistant";
import { openArtifactDb } from "@dashframe/server-core";
import type { Field } from "@dashframe/types";
import type { Command } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { neighbors } from "@dashframe/assistant";
import { buildDashframeApp, createDraftController } from "./app";
import { createAssistantReadHost } from "./assistant-read-host";
import { cmd } from "./functions/commands";

describe("assistant read host (resolver over the real server seam)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: Awaited<ReturnType<typeof buildDashframeApp>>;
  let controller: ReturnType<typeof createDraftController>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-read-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await buildDashframeApp({ db });
    controller = createDraftController(app, db);
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const id = () => crypto.randomUUID();

  /** Publish a batch to CANONICAL through the controller (its only write seam). */
  async function publish(...commands: Command[]) {
    const d = await controller.openDraft();
    await controller.appendToDraft(d, commands);
    await controller.publishDraft(d);
  }

  function field(name: string, sensitivity: Field["sensitivity"]): Field {
    return { id: id(), name, tableId: "", type: "string", sensitivity };
  }

  // -------------------------------------------------------------------------
  // Draft overlay: the reader sees the assistant's in-progress draft edits.
  // -------------------------------------------------------------------------
  it("a draft-scoped reader sees an insight created inside the draft; canonical does not", async () => {
    const sourceId = id();
    const tableId = id();
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
      }),
    );

    // Create an insight INSIDE a draft (not published).
    const draftId = await controller.openDraft();
    const insightId = id();
    await controller.appendToDraft(draftId, [
      cmd("CreateInsight", {
        id: insightId,
        name: "Draft-only insight",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    ]);

    // Draft-scoped reader: the insight is visible (reads the overlay).
    const draftReader = createAssistantReadHost({ app, draftId });
    const fromDraft = await draftReader.getInsight(insightId);
    expect(fromDraft?.name).toBe("Draft-only insight");

    // Canonical reader (no draftId): the insight does NOT exist yet.
    const canonicalReader = createAssistantReadHost({ app });
    expect(await canonicalReader.getInsight(insightId)).toBeNull();
  });

  it("filtered list reads do NOT throw under an active draftId (non-PK filter)", async () => {
    // The draft-overlay coalesce THROWS on a non-PK server-side read filter
    // (app.ts withDraftSeam contract). The host adapter must read unfiltered and
    // filter in JS. Exercise the filtered paths under a draftId: they must
    // succeed, not throw.
    const sourceId = id();
    const tableId = id();
    const insightId = id();
    const vizId = id();
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
      }),
      cmd("CreateInsight", {
        id: insightId,
        name: "Revenue",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
      cmd("CreateVisualization", {
        id: vizId,
        name: "Bar",
        insightId,
        visualizationType: "barY",
        spec: {},
      }),
    );

    const draftId = await controller.openDraft();
    const reader = createAssistantReadHost({ app, draftId });
    // Each of these issues a non-PK filter that would throw if sent server-side
    // under the draft; the adapter reads unfiltered + filters in JS.
    expect((await reader.listDataTables(sourceId)).map((t) => t.id)).toEqual([
      tableId,
    ]);
    expect(
      (await reader.listVisualizations(insightId)).map((v) => v.id),
    ).toEqual([vizId]);
    // getDataFrameByInsight (no dataframe materialized) resolves to null, not throw.
    expect(await reader.getDataFrameByInsight(insightId)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Inherit-source masking over REAL Field.sensitivity.
  // -------------------------------------------------------------------------
  it("readData masks (profiles-only) when a real source column is sensitive", async () => {
    const sourceId = id();
    const tableId = id();
    const emailField = field("email", "sensitive");
    const amountField = field("amount", "cleared");
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
        fields: [
          { ...emailField, tableId },
          { ...amountField, tableId },
        ],
      }),
    );

    const reader = createAssistantReadHost({ app });
    const { readData } = createReadTools(reader);

    const res = await readData.execute("c", { kind: "dataTable", id: tableId });
    const data = res.details as DataReadResult;

    // Masked: a sensitive source column inherits up to the whole read.
    expect(data.masked).toBe(true);
    // Structure NEVER gated: both columns + their real sensitivity flow.
    const byName = new Map(data.columns.map((c) => [c.name, c]));
    expect(byName.get("email")?.sensitivity).toBe("sensitive");
    expect(byName.get("amount")?.sensitivity).toBe("cleared");
    // Profiles-only — no raw rows.
    expect(data.sample).toBeUndefined();
  });

  it("readData does NOT mask a fully-cleared source, still profiles-only", async () => {
    const sourceId = id();
    const tableId = id();
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Regions",
        table: "regions.csv",
        fields: [{ ...field("region", "cleared"), tableId }],
      }),
    );

    const reader = createAssistantReadHost({ app });
    const { readData } = createReadTools(reader);
    const res = await readData.execute("c", { kind: "dataTable", id: tableId });
    const data = res.details as DataReadResult;
    expect(data.masked).toBe(false);
    expect(data.columns.map((c) => c.name)).toEqual(["region"]);
    expect(data.sample).toBeUndefined();
  });

  it("masks (fail-closed) a table with UNKNOWN columns (no fields discovered yet)", async () => {
    // A table created before schema discovery/classification has empty `fields`.
    // "Unknown columns" must mask exactly like "unresolvable" — a not-yet-seen
    // column could be sensitive, so an unclassified table reads MASKED.
    const sourceId = id();
    const tableId = id();
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Undiscovered",
        table: "undiscovered.csv",
        // no `fields` — columns not discovered yet
      }),
    );
    const reader = createAssistantReadHost({ app });
    const { readData } = createReadTools(reader);
    const res = await readData.execute("c", { kind: "dataTable", id: tableId });
    expect((res.details as DataReadResult).masked).toBe(true);
  });

  it("an insight inherits its base table's sensitivity (insight result masks)", async () => {
    const sourceId = id();
    const tableId = id();
    const emailField = field("email", "sensitive");
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
        fields: [{ ...emailField, tableId }],
      }),
    );
    const insightId = id();
    await publish(
      cmd("CreateInsight", {
        id: insightId,
        name: "Revenue",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [emailField.id],
      }),
    );

    const reader = createAssistantReadHost({ app });
    const { readData } = createReadTools(reader);
    // A viz reads its insight's result — the agent reads the insight here.
    const res = await readData.execute("c", { kind: "insight", id: insightId });
    expect((res.details as DataReadResult).masked).toBe(true);
  });

  it("masks when a METRIC's sourceTable (a DIFFERENT, sensitive table) is read", async () => {
    // Isolate the metric-resolution path: the BASE table is fully cleared; the
    // sensitive column lives ONLY in a separate table reached via the metric's
    // sourceTable. Masking therefore depends solely on the metric hop resolving
    // that table — narrowing to selectedFields (or skipping metric tables) fails
    // OPEN here.
    const sourceId = id();
    const baseTableId = id();
    const metricTableId = id();
    const regionField = field("region", "cleared");
    const salaryField = field("salary", "sensitive");
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: baseTableId,
        dataSourceId: sourceId,
        name: "Regions",
        table: "regions.csv",
        fields: [{ ...regionField, tableId: baseTableId }], // cleared base
      }),
      cmd("CreateDataTable", {
        id: metricTableId,
        dataSourceId: sourceId,
        name: "Salaries",
        table: "salaries.csv",
        fields: [{ ...salaryField, tableId: metricTableId }], // sensitive, metric-only
      }),
    );
    const insightId = id();
    await publish(
      cmd("CreateInsight", {
        id: insightId,
        name: "Avg salary by region",
        source: { sourceType: "dataTable", sourceId: baseTableId },
        selectedFields: [regionField.id], // cleared dimension ONLY
        metrics: [
          {
            id: id(),
            name: "Avg salary",
            sourceTable: metricTableId, // ← sensitive table, NOT the base
            columnName: "salary",
            aggregation: "avg",
          },
        ],
      }),
    );

    const reader = createAssistantReadHost({ app });
    const { readData } = createReadTools(reader);
    const res = await readData.execute("c", { kind: "insight", id: insightId });
    expect((res.details as DataReadResult).masked).toBe(true);
  });

  it("masks (fail-closed) when a joined table is DELETED out from under the insight", async () => {
    // AddJoin validates rightTableId at write time, so a dangling ref arises via
    // DELETION: deleting a DataTable does NOT cascade-delete dependent insights
    // (drift-repair territory), leaving the join's rightTableId dangling. The
    // base is cleared, so masking depends entirely on the dangling-ref →
    // forceMask path — a vanished table may have held the only sensitive column.
    const sourceId = id();
    const baseTableId = id();
    const joinTableId = id();
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: baseTableId,
        dataSourceId: sourceId,
        name: "Regions",
        table: "regions.csv",
        fields: [{ ...field("region", "cleared"), tableId: baseTableId }],
      }),
      cmd("CreateDataTable", {
        id: joinTableId,
        dataSourceId: sourceId,
        name: "Lookup",
        table: "lookup.csv",
        fields: [{ ...field("code", "cleared"), tableId: joinTableId }],
      }),
    );
    const insightId = id();
    await publish(
      cmd("CreateInsight", {
        id: insightId,
        name: "Joined",
        source: { sourceType: "dataTable", sourceId: baseTableId },
      }),
    );
    await publish(
      cmd("AddJoin", {
        id: insightId,
        join: {
          type: "left",
          rightTableId: joinTableId,
          leftKey: "region",
          rightKey: "code",
        },
      }),
    );
    // Now delete the joined table — the insight's join ref is left dangling.
    await publish(cmd("DeleteNode", { id: joinTableId }));

    const reader = createAssistantReadHost({ app });
    const { readData } = createReadTools(reader);
    const res = await readData.execute("c", { kind: "insight", id: insightId });
    // Dangling join table → forceMask → masked, even though the base is cleared.
    expect((res.details as DataReadResult).masked).toBe(true);
  });

  it("masks a composed insight (insight-on-insight) whose upstream source is sensitive", async () => {
    // baseTableId of an insight-sourced insight holds the UPSTREAM INSIGHT id.
    // Resolving it as a table would yield null → empty set → fail OPEN.
    const sourceId = id();
    const tableId = id();
    const emailField = field("email", "sensitive");
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
        fields: [{ ...emailField, tableId }],
      }),
    );
    const baseInsightId = id();
    await publish(
      cmd("CreateInsight", {
        id: baseInsightId,
        name: "Base",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [emailField.id],
      }),
    );
    const composedInsightId = id();
    await publish(
      cmd("CreateInsight", {
        id: composedInsightId,
        name: "Composed",
        source: { sourceType: "insight", sourceId: baseInsightId },
      }),
    );

    const reader = createAssistantReadHost({ app });
    const { readData } = createReadTools(reader);
    const res = await readData.execute("c", {
      kind: "insight",
      id: composedInsightId,
    });
    // Inherits the upstream insight's sensitive source through the chain.
    expect((res.details as DataReadResult).masked).toBe(true);

    // And the composed insight's neighborhood reaches its upstream INSIGHT (the
    // base edge is not silently dropped as a non-existent table).
    const hood = await neighbors(reader, {
      kind: "insight",
      id: composedInsightId,
    });
    expect(
      hood!.downstream.some(
        (n) => n.ref.kind === "insight" && n.ref.id === baseInsightId,
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Neighborhood over real artifacts.
  // -------------------------------------------------------------------------
  it("neighborhood of an insight = its base table (down) + viz (up), 1 hop", async () => {
    const sourceId = id();
    const tableId = id();
    const insightId = id();
    const vizId = id();
    await publish(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
      }),
      cmd("CreateInsight", {
        id: insightId,
        name: "Revenue",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
      cmd("CreateVisualization", {
        id: vizId,
        name: "Bar",
        insightId,
        visualizationType: "barY",
        spec: {},
      }),
    );

    const reader = createAssistantReadHost({ app });
    const hood = await neighbors(reader, { kind: "insight", id: insightId });
    expect(hood).not.toBeNull();
    expect(hood!.downstream.map((n) => n.ref.id)).toContain(tableId);
    expect(hood!.upstream.map((n) => n.ref.id)).toContain(vizId);
    // NOT the source (2 hops down) — ambient is 1 hop.
    expect(hood!.downstream.map((n) => n.ref.id)).not.toContain(sourceId);
  });
});

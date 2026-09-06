/**
 * Assistant read-host adapter tests over explicit ApplicationOperations DTO fixtures.
 * These exercise draft-context dispatch, graph traversal, field-sensitivity masking,
 * and private-frame projection. Native storage and transaction semantics are covered
 * by convex-backend tests rather than simulated by this fixture.
 */
import {
  createReadTools,
  neighbors,
  type DataReadResult,
} from "@dashframe/assistant";
import { cmd, type Command, type Field } from "@dashframe/types";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ApplicationOperations } from "./host/application";
import { createAssistantReadHost } from "./assistant-read-host";

type Artifact = Record<string, unknown> & { id: string; kind: string };

function createReadFixture() {
  const canonical = new Map<string, Artifact>();
  const drafts = new Map<string, Map<string, Artifact>>();
  const kinds: Record<string, string> = {
    DataSource: "dataSource",
    DataTable: "dataTable",
    DataFrameEntry: "dataFrame",
    Insight: "insight",
    Visualization: "visualization",
    Dashboard: "dashboard",
  };
  const execute = vi.fn<ApplicationOperations["execute"]>(
    async (operation, input, context) => {
      const records = context?.draftId
        ? drafts.get(context.draftId)
        : canonical;
      if (!records) throw new Error("Unknown fixture draft");
      const args = input as { id?: string };
      if (operation.startsWith("get")) {
        const found = args.id ? records.get(args.id) : undefined;
        const expectedKind = kinds[operation.slice(3)];
        if (!expectedKind) throw new Error(`Unexpected read: ${operation}`);
        return found?.kind === expectedKind ? structuredClone(found) : null;
      }
      if (operation.startsWith("list")) {
        const entity = operation.slice(4, -1);
        const expectedKind =
          entity === "DataFrame" ? "dataFrame" : kinds[entity];
        if (!expectedKind) throw new Error(`Unexpected list: ${operation}`);
        return structuredClone(
          [...records.values()].filter((row) => row.kind === expectedKind),
        );
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  );
  const app: ApplicationOperations = { execute, forPrincipal: () => app };
  function seed(commands: Command[], draftId?: string) {
    const records = draftId ? drafts.get(draftId)! : canonical;
    for (const command of commands) {
      const args = command.args as Record<string, unknown> & { id: string };
      if (command.path === "deleteNode") {
        records.delete(args.id);
        continue;
      }
      if (command.path === "addJoin") {
        const insight = records.get(args.id)!;
        const joins = insight.joins as unknown[];
        insight.joins = [...joins, args.join];
        continue;
      }
      const kind = (
        {
          createDataSource: "dataSource",
          createDataTable: "dataTable",
          createInsightCmd: "insight",
          createVisualizationCmd: "visualization",
        } as Record<string, string>
      )[command.path];
      if (!kind) throw new Error(`Unsupported fixture seed: ${command.path}`);
      records.set(args.id, {
        fields: [],
        metrics: [],
        joins: [],
        selectedFields: [],
        config: {},
        createdAt: 1,
        ...structuredClone(args),
        kind,
      });
    }
  }
  return {
    app,
    execute,
    seed,
    createDraft() {
      const draftId = crypto.randomUUID();
      drafts.set(draftId, structuredClone(canonical));
      return draftId;
    },
  };
}

describe("assistant read host (ApplicationOperations adapter)", () => {
  let fixture: ReturnType<typeof createReadFixture>;
  let app: ApplicationOperations;
  beforeEach(() => {
    fixture = createReadFixture();
    app = fixture.app;
  });

  const id = () => crypto.randomUUID();

  /** Seed DTOs only: native metadata transaction behavior is tested in convex-backend. */
  async function seedCanonical(...commands: Command[]) {
    fixture.seed(commands);
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
    await seedCanonical(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
      }),
    );

    // Create an insight INSIDE a draft (not published).
    const draftId = fixture.createDraft();
    const insightId = id();
    fixture.seed(
      [
        cmd("CreateInsight", {
          id: insightId,
          name: "Draft-only insight",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      ],
      draftId,
    );

    // Draft-scoped reader: the insight is visible (reads the overlay).
    const draftReader = createAssistantReadHost({ app, draftId });
    const fromDraft = await draftReader.getInsight(insightId);
    expect(fromDraft?.name).toBe("Draft-only insight");

    // Canonical reader (no draftId): the insight does NOT exist yet.
    const canonicalReader = createAssistantReadHost({ app });
    expect(await canonicalReader.getInsight(insightId)).toBeNull();
    expect(fixture.execute).toHaveBeenCalledWith(
      "getInsight",
      { id: insightId },
      { draftId },
    );
    expect(fixture.execute).toHaveBeenCalledWith(
      "getInsight",
      { id: insightId },
      {},
    );
  });

  it("filtered list reads preserve draft scope and return only matching artifacts", async () => {
    // The adapter obtains the scoped list and applies its graph-port filters.
    const sourceId = id();
    const tableId = id();
    const insightId = id();
    const vizId = id();
    await seedCanonical(
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

    const otherSourceId = id();
    const otherTableId = id();
    const otherInsightId = id();
    await seedCanonical(
      cmd("CreateDataSource", {
        id: otherSourceId,
        type: "csv",
        name: "Other",
      }),
      cmd("CreateDataTable", {
        id: otherTableId,
        dataSourceId: otherSourceId,
        name: "Other",
        table: "other.csv",
      }),
      cmd("CreateInsight", {
        id: otherInsightId,
        name: "Other insight",
        source: { sourceType: "dataTable", sourceId: otherTableId },
      }),
      cmd("CreateVisualization", {
        id: id(),
        name: "Other visualization",
        insightId: otherInsightId,
        visualizationType: "barY",
        spec: {},
      }),
    );
    const draftId = fixture.createDraft();
    const reader = createAssistantReadHost({ app, draftId });
    // Assert both the filtered result and the draft context sent to the port.
    expect((await reader.listDataTables(sourceId)).map((t) => t.id)).toEqual([
      tableId,
    ]);
    expect(
      (await reader.listVisualizations(insightId)).map((v) => v.id),
    ).toEqual([vizId]);
    expect(fixture.execute).toHaveBeenCalledWith(
      "listDataTables",
      {},
      { draftId },
    );
    expect(fixture.execute).toHaveBeenCalledWith(
      "listVisualizations",
      {},
      { draftId },
    );
    // No frame has been materialized for the insight.
    expect(await reader.getDataFrameByInsight(insightId)).toBeNull();
  });

  it("projects server-private DataFrame metadata at the assistant boundary", async () => {
    const frameId = id();
    const insightId = id();
    const fieldId = id();
    const storageKey = `/private/project/${id()}.arrow`;
    const secretRef = `secret:${id()}`;
    const rawFrame = {
      id: frameId,
      name: "Revenue result",
      insightId,
      fieldIds: [fieldId],
      rowCount: 12,
      columnCount: 1,
      createdAt: 1_723_000_000_000,
      lastRefreshedAt: 1_723_000_001_000,
      currentInsightResult: true,
      storage: { type: "file", key: storageKey },
      primaryKey: "id",
      sourceId: id(),
      definitionId: id(),
      analysis: { credentialRef: secretRef },
    };
    const fakeApp: ApplicationOperations = {
      forPrincipal: () => fakeApp,
      execute: async (path: string) => {
        if (path === "getDataFrameEntry") return rawFrame;
        if (path === "listDataFrames") return [rawFrame];
        throw new Error(`Unexpected read: ${path}`);
      },
    };
    const reader = createAssistantReadHost({ app: fakeApp });

    const single = await reader.getDataFrameEntry(frameId);
    const listed = await reader.listDataFrames();
    const byInsight = await reader.getDataFrameByInsight(insightId);

    expect(single).toEqual({
      id: frameId,
      name: "Revenue result",
      insightId,
      fieldIds: [fieldId],
      rowCount: 12,
      columnCount: 1,
      createdAt: 1_723_000_000_000,
      lastRefreshedAt: 1_723_000_001_000,
      currentInsightResult: true,
    });
    expect(listed).toEqual([single]);
    expect(byInsight).toEqual(single);
    const serialized = JSON.stringify({ single, listed, byInsight });
    expect(serialized).not.toContain(storageKey);
    expect(serialized).not.toContain(secretRef);
    expect(serialized).not.toContain("storage");
    expect(serialized).not.toContain("sourceId");
    expect(serialized).not.toContain("definitionId");
    expect(serialized).not.toContain("analysis");
  });

  // -------------------------------------------------------------------------
  // Inherit-source masking over Field.sensitivity.
  // -------------------------------------------------------------------------
  it("readData masks (profiles-only) when a source field is sensitive", async () => {
    const sourceId = id();
    const tableId = id();
    const emailField = field("email", "sensitive");
    const amountField = field("amount", "cleared");
    await seedCanonical(
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
    // Structure NEVER gated: both columns + their declared sensitivity flow.
    const byName = new Map(data.columns.map((c) => [c.name, c]));
    expect(byName.get("email")?.sensitivity).toBe("sensitive");
    expect(byName.get("amount")?.sensitivity).toBe("cleared");
    // Profiles-only — no raw rows.
    expect(data.sample).toBeUndefined();
  });

  it("readData does NOT mask a fully-cleared source, still profiles-only", async () => {
    const sourceId = id();
    const tableId = id();
    await seedCanonical(
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
    await seedCanonical(
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
    await seedCanonical(
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
    await seedCanonical(
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
    await seedCanonical(
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
    await seedCanonical(
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
    // (repair target TBD), leaving the join's rightTableId dangling. The
    // base is cleared, so masking depends entirely on the dangling-ref →
    // forceMask path — a vanished table may have held the only sensitive column.
    const sourceId = id();
    const baseTableId = id();
    const joinTableId = id();
    await seedCanonical(
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
    await seedCanonical(
      cmd("CreateInsight", {
        id: insightId,
        name: "Joined",
        source: { sourceType: "dataTable", sourceId: baseTableId },
      }),
    );
    await seedCanonical(
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
    await seedCanonical(cmd("DeleteNode", { id: joinTableId }));

    const reader = createAssistantReadHost({ app });
    const { readData } = createReadTools(reader);
    const res = await readData.execute("c", { kind: "insight", id: insightId });
    // Dangling join table → forceMask → masked, even though the base is cleared.
    expect((res.details as DataReadResult).masked).toBe(true);
  });

  it("masks a composed insight (insight-on-insight) whose upstream source is sensitive", async () => {
    // The source discriminator identifies the upstream Insight directly.
    // Resolving it as a table would yield null → empty set → fail OPEN.
    const sourceId = id();
    const tableId = id();
    const emailField = field("email", "sensitive");
    await seedCanonical(
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
    await seedCanonical(
      cmd("CreateInsight", {
        id: baseInsightId,
        name: "Base",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [emailField.id],
      }),
    );
    const composedInsightId = id();
    await seedCanonical(
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
  // Neighborhood over artifact DTOs.
  // -------------------------------------------------------------------------
  it("neighborhood of an insight = its base table (down) + viz (up), 1 hop", async () => {
    const sourceId = id();
    const tableId = id();
    const insightId = id();
    const vizId = id();
    await seedCanonical(
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

/**
 * Read-layer contracts — the privacy-aware graph resolver.
 *
 * These tests pin the LOAD-BEARING contracts of the read layer against an
 * in-memory fake GraphReader (a hand-built artifact graph). The fake stands in
 * for the host's draft-scoped server seam; the apps/server integration test
 * proves the SAME resolver against a real PGlite app + real draft overlay +
 * real Field.sensitivity. Here we prove the resolver logic and the floor in
 * isolation, where cause→effect is obvious.
 *
 * Contracts under test:
 *   - readNeighborhood = invocation point + 1 hop, NOT the whole graph.
 *   - readGraph / find navigate BEYOND one hop.
 *   - readArtifact returns structure (the definition), ungated.
 *   - readData masks (profiles-only) when a source column is sensitive; never
 *     gates structure; emits NO raw rows and NO result-classification.
 */

import type {
  DataSource,
  DataTable,
  Field,
  Insight,
  Visualization,
} from "@dashframe/types";
import { describe, expect, it } from "vitest";

import { applyFloor, isMaskedBySource } from "./floor.js";
import { neighbors, search, traverse } from "./graph.js";
import type {
  DashboardRead,
  DataFrameRead,
  DataReadResult,
  GraphReader,
  NodeRef,
} from "./port.js";
import { createReadTools } from "./tools.js";

// ---------------------------------------------------------------------------
// A small fixed graph:
//
//   source(src1) ─owns→ table(tblOrders) ─reads→ insight(insRevenue) ─renders→ viz(vizBar) ─placed→ dashboard(dashMain)
//
// tblOrders has a sensitive `email` column and a cleared `amount` column.
// A SECOND, fully-cleared table (tblPublic) feeds insight insPublic — used to
// prove an unmasked read.
// ---------------------------------------------------------------------------

const FIELD_EMAIL: Field = {
  id: "f-email",
  name: "email",
  tableId: "tblOrders",
  type: "string",
  sensitivity: "sensitive",
};
const FIELD_AMOUNT: Field = {
  id: "f-amount",
  name: "amount",
  tableId: "tblOrders",
  type: "number",
  sensitivity: "cleared",
};
const FIELD_REGION: Field = {
  id: "f-region",
  name: "region",
  tableId: "tblPublic",
  type: "string",
  sensitivity: "cleared",
};

const SRC: DataSource = {
  id: "src1",
  type: "rest",
  name: "Orders API",
  config: {} as DataSource["config"],
  createdAt: 0,
};
const TBL_ORDERS: DataTable = {
  id: "tblOrders",
  dataSourceId: "src1",
  name: "Orders",
  table: "orders",
  fields: [FIELD_EMAIL, FIELD_AMOUNT],
  metrics: [],
  createdAt: 0,
};
const TBL_PUBLIC: DataTable = {
  id: "tblPublic",
  dataSourceId: "src1",
  name: "Regions",
  table: "regions",
  fields: [FIELD_REGION],
  metrics: [],
  createdAt: 0,
};
const INS_REVENUE: Insight = {
  id: "insRevenue",
  name: "Revenue by email",
  baseTableId: "tblOrders",
  selectedFields: ["f-email", "f-amount"],
  metrics: [],
  createdAt: 0,
};
const INS_PUBLIC: Insight = {
  id: "insPublic",
  name: "Regions list",
  baseTableId: "tblPublic",
  selectedFields: ["f-region"],
  metrics: [],
  createdAt: 0,
};
// Insight-on-insight composition: baseTableId holds an INSIGHT id, not a table.
const INS_COMPOSED: Insight = {
  id: "insComposed",
  name: "Composed over revenue",
  baseTableId: "insRevenue", // ← an insight id (the upstream source)
  selectedFields: [],
  metrics: [],
  createdAt: 0,
};
const VIZ_BAR: Visualization = {
  id: "vizBar",
  insightId: "insRevenue",
  name: "Revenue bar",
  visualizationType: "barY",
  spec: {} as Visualization["spec"],
  createdAt: 0,
};
const DASH_MAIN: DashboardRead = {
  id: "dashMain",
  name: "Main dashboard",
  items: [{ id: "item1", type: "visualization", visualizationId: "vizBar" }],
};

const DATAFRAME: DataFrameRead = {
  id: "df1",
  name: "Revenue result",
  insightId: "insRevenue",
  fieldIds: ["f-email", "f-amount"],
};

/** A fake reader over the fixed graph. `readDataProfile` mirrors the host: it
 * resolves the artifact's source fields and runs them through `applyFloor`. */
function makeReader(): GraphReader {
  const tables = [TBL_ORDERS, TBL_PUBLIC];
  const insights = [INS_REVENUE, INS_PUBLIC, INS_COMPOSED];
  const vizzes = [VIZ_BAR];
  const dashboards = [DASH_MAIN];

  const sourceFieldsFor = (node: NodeRef): Field[] => {
    if (node.kind === "dataTable")
      return tables.find((t) => t.id === node.id)?.fields ?? [];
    const ins = insights.find((i) => i.id === node.id);
    if (!ins) return [];
    const tbl = tables.find((t) => t.id === ins.baseTableId);
    const byId = new Map((tbl?.fields ?? []).map((f) => [f.id, f]));
    return (ins.selectedFields ?? [])
      .map((id) => byId.get(id))
      .filter((f): f is Field => f !== undefined);
  };

  return {
    getDataSource: async (id) => (id === "src1" ? SRC : null),
    getDataTable: async (id) => tables.find((t) => t.id === id) ?? null,
    getDataFrameEntry: async (id) => (id === "df1" ? DATAFRAME : null),
    getInsight: async (id) => insights.find((i) => i.id === id) ?? null,
    getVisualization: async (id) => vizzes.find((v) => v.id === id) ?? null,
    getDashboard: async (id) => dashboards.find((d) => d.id === id) ?? null,
    listDataSources: async () => [SRC],
    listDataTables: async (dataSourceId) =>
      dataSourceId
        ? tables.filter((t) => t.dataSourceId === dataSourceId)
        : tables,
    listDataFrames: async () => [DATAFRAME],
    listInsights: async () => insights,
    listVisualizations: async (insightId) =>
      insightId ? vizzes.filter((v) => v.insightId === insightId) : vizzes,
    listDashboards: async () => dashboards,
    getDataFrameByInsight: async (insightId) =>
      insightId === "insRevenue" ? DATAFRAME : null,
    readDataProfile: async (node) =>
      applyFloor(
        node,
        sourceFieldsFor(node).map((f) => ({
          name: f.name,
          type: f.type,
          sensitivity: f.sensitivity,
        })),
      ),
    readSource: async (file) =>
      file === "apps/server/src/functions/commands.ts"
        ? "// source text"
        : null,
  };
}

// ---------------------------------------------------------------------------
// Neighborhood = invocation point + 1 hop (NOT the whole graph)
// ---------------------------------------------------------------------------

describe("readNeighborhood — ambient = invocation + 1 hop", () => {
  it("returns only direct neighbors of the insight, both directions", async () => {
    const reader = makeReader();
    const hood = await neighbors(reader, { kind: "insight", id: "insRevenue" });
    expect(hood).not.toBeNull();
    expect(hood!.center.name).toBe("Revenue by email");

    // downstream: base table + result dataframe (1 hop down).
    const down = hood!.downstream.map((n) => n.ref.id).sort();
    expect(down).toEqual(["df1", "tblOrders"]);
    // upstream (1 hop up): the viz that renders it + the insight composed ON it
    // (insComposed's base is insRevenue — the reverse insight-on-insight edge).
    expect(hood!.upstream.map((n) => n.ref.id).sort()).toEqual([
      "insComposed",
      "vizBar",
    ]);

    // NOT the whole graph: the dashboard (2 hops up) is absent from neighbors.
    const allIds = [...down, ...hood!.upstream.map((n) => n.ref.id)];
    expect(allIds).not.toContain("dashMain");
    expect(allIds).not.toContain("src1");
  });

  it("returns null for a missing invocation point", async () => {
    const reader = makeReader();
    expect(await neighbors(reader, { kind: "insight", id: "nope" })).toBeNull();
  });

  it("resolves a composed insight's base as an INSIGHT, not a dropped table edge", async () => {
    const reader = makeReader();
    const hood = await neighbors(reader, {
      kind: "insight",
      id: "insComposed",
    });
    // baseTableId is an insight id; the edge must resolve to that insight (down),
    // never silently dropped by probing it as a non-existent table.
    expect(
      hood!.downstream.some(
        (n) => n.ref.kind === "insight" && n.ref.id === "insRevenue",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readGraph / find navigate BEYOND one hop
// ---------------------------------------------------------------------------

describe("readGraph / find — global reach beyond one hop", () => {
  it("traverse reaches the dashboard from the insight at depth 2", async () => {
    const reader = makeReader();
    const reached = await traverse(
      reader,
      { kind: "insight", id: "insRevenue" },
      2,
    );
    const dash = reached.find((r) => r.ref.id === "dashMain");
    expect(dash).toBeDefined();
    expect(dash!.depth).toBe(2); // insight → viz (1) → dashboard (2)
  });

  it("traverse at depth 0 returns only the origin", async () => {
    const reader = makeReader();
    const reached = await traverse(
      reader,
      { kind: "insight", id: "insRevenue" },
      0,
    );
    expect(reached.map((r) => r.ref.id)).toEqual(["insRevenue"]);
  });

  it("find by name substring matches across kinds", async () => {
    const reader = makeReader();
    const hits = await search(reader, { name: "revenue" });
    const ids = hits.map((h) => h.ref.id).sort();
    // "Revenue by email" (insight), "Composed over revenue" (insight),
    // "Revenue result" (dataFrame — now searchable), "Revenue bar" (viz).
    expect(ids).toEqual(["df1", "insComposed", "insRevenue", "vizBar"]);
  });

  it("find by kind restricts the result set", async () => {
    const reader = makeReader();
    const hits = await search(reader, { kind: "dataTable" });
    expect(hits.map((h) => h.ref.kind)).toEqual(["dataTable", "dataTable"]);
  });

  it("find by kind 'dataFrame' returns dataFrames (KindSchema accepts it)", async () => {
    const reader = makeReader();
    const hits = await search(reader, { kind: "dataFrame" });
    expect(hits.map((h) => h.ref.id)).toEqual(["df1"]);
  });

  it("empty find lists every node (the ls)", async () => {
    const reader = makeReader();
    const hits = await search(reader, {});
    // 1 source + 2 tables + 1 dataFrame + 3 insights + 1 viz + 1 dashboard = 9
    expect(hits.length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// readArtifact returns structure (the definition), ungated
// ---------------------------------------------------------------------------

describe("readArtifact — structure, ungated", () => {
  it("returns the insight's full definition (query shape)", async () => {
    const reader = makeReader();
    const { readArtifact } = createReadTools(reader);
    const res = await readArtifact.execute("c", {
      kind: "insight",
      id: "insRevenue",
    });
    expect(res.details).toMatchObject({
      kind: "insight",
      definition: { id: "insRevenue", baseTableId: "tblOrders" },
    });
    // Structure is ungated even though the insight touches a sensitive column.
    const def = (res.details as { definition: Insight }).definition;
    expect(def.selectedFields).toEqual(["f-email", "f-amount"]);
  });

  it("reports not_found for a missing artifact", async () => {
    const reader = makeReader();
    const { readArtifact } = createReadTools(reader);
    const res = await readArtifact.execute("c", {
      kind: "dashboard",
      id: "nope",
    });
    expect(res.details).toEqual({ error: "not_found" });
  });
});

describe("read_source — allowlisted backup path", () => {
  it("returns the command source for an allowlisted file", async () => {
    const reader = makeReader();
    const { readSource } = createReadTools(reader);
    const res = await readSource.execute("c", {
      file: "apps/server/src/functions/commands.ts",
    });
    expect(res.details).toMatchObject({
      file: "apps/server/src/functions/commands.ts",
    });
    expect((res.details as { text: string }).text).toContain("source text");
  });

  it("refuses a non-allowlisted file", async () => {
    const reader = makeReader();
    const { readSource } = createReadTools(reader);
    const res = await readSource.execute("c", { file: "/etc/passwd" });
    expect(res.details).toEqual({ error: "not_readable" });
  });
});

// ---------------------------------------------------------------------------
// readData — the FLOOR: binary inherit-source, profiles-only, never gates structure
// ---------------------------------------------------------------------------

describe("isMaskedBySource — the binary inherit-source decision", () => {
  it("masks when ANY source field is sensitive", () => {
    expect(isMaskedBySource([FIELD_AMOUNT, FIELD_EMAIL])).toBe(true);
  });
  it("masks when a field is unclassified (fail-closed)", () => {
    expect(isMaskedBySource([{ sensitivity: "unclassified" }])).toBe(true);
    expect(isMaskedBySource([{}])).toBe(true); // absent === unclassified
  });
  it("does NOT mask when every source field is cleared", () => {
    expect(isMaskedBySource([FIELD_AMOUNT, FIELD_REGION])).toBe(false);
  });
});

describe("applyFloor — fail-closed on incomplete resolution (forceMask)", () => {
  const node: NodeRef = { kind: "insight", id: "x" };

  it("masks a cleared field set when forceMask is set (couldn't enumerate source)", () => {
    // The fail-open hazard: a host that can't walk an insight's full source chain
    // resolves to an incomplete (here, empty/cleared) field set. forceMask makes
    // the floor mask regardless — an unmasked-but-incomplete read is the leak.
    expect(applyFloor(node, []).masked).toBe(false); // empty .some() is false…
    expect(applyFloor(node, [], { forceMask: true }).masked).toBe(true); // …forced closed
    expect(
      applyFloor(
        node,
        [{ name: "a", type: "string", sensitivity: "cleared" }],
        {
          forceMask: true,
        },
      ).masked,
    ).toBe(true);
  });

  it("forceMask can only make a read MORE restrictive, never less", () => {
    // A sensitive field already masks; forceMask:false doesn't unmask it.
    expect(
      applyFloor(
        node,
        [{ name: "e", type: "string", sensitivity: "sensitive" }],
        { forceMask: false },
      ).masked,
    ).toBe(true);
  });
});

describe("readData — tiered data, floor-gated", () => {
  it("masks an insight whose source has a sensitive column (table + insight)", async () => {
    const reader = makeReader();
    const { readData } = createReadTools(reader);

    // Insight result (a viz reads its insight's result via this).
    const insRes = await readData.execute("c", {
      kind: "insight",
      id: "insRevenue",
    });
    const ins = insRes.details as DataReadResult;
    expect(ins.masked).toBe(true);
    // Structure NEVER gated: column names/types/sensitivity always flow.
    expect(ins.columns.map((c) => c.name).sort()).toEqual(["amount", "email"]);
    expect(ins.columns.find((c) => c.name === "email")!.sensitivity).toBe(
      "sensitive",
    );
    // Profiles-only: NO raw rows. (`sample` is the never-set seam.)
    expect(ins.sample).toBeUndefined();

    // Same masking applies reading the underlying TABLE directly.
    const tblRes = await readData.execute("c", {
      kind: "dataTable",
      id: "tblOrders",
    });
    expect((tblRes.details as DataReadResult).masked).toBe(true);
  });

  it("does NOT mask a fully-cleared source, still profiles-only (no rows)", async () => {
    const reader = makeReader();
    const { readData } = createReadTools(reader);
    const res = await readData.execute("c", {
      kind: "insight",
      id: "insPublic",
    });
    const data = res.details as DataReadResult;
    expect(data.masked).toBe(false);
    expect(data.columns.map((c) => c.name)).toEqual(["region"]);
    // Even unmasked, v0.3 emits profiles-only — no raw sample until the perception assembler lands.
    expect(data.sample).toBeUndefined();
  });

  it("masks a fully-cleared TABLE only when all its fields are cleared", async () => {
    const reader = makeReader();
    const { readData } = createReadTools(reader);
    const res = await readData.execute("c", {
      kind: "dataTable",
      id: "tblPublic",
    });
    expect((res.details as DataReadResult).masked).toBe(false);
  });
});

/**
 * The COMMAND VOCABULARY GUIDE — the assistant's PRIMARY reference for the
 * commands it can apply (the applyCommand tool lands next and depends on
 * this).
 *
 * Each entry is a concise CONTRACT per command: the command NAME (the `cmd()`
 * name the apply tool uses), a one-line summary of effect, and its argument
 * shape. This is hand-crafted for the agent — a clean, navigable surface, not a
 * dump of the source. The SOURCE (apps/server/src/functions/commands.ts) is the
 * BACKUP/verification path: the agent can open it via `readSource` when the
 * guide is insufficient.
 *
 * FRESHNESS: the guide can DRIFT from the real command registry as commands are
 * added/removed. `GUIDE_COMMAND_NAMES` is the freshness anchor — a test in
 * apps/server (command-guide-freshness.test.ts) compares it against the live
 * `COMMAND_PATHS` registry and FAILS when they diverge, so a new command without
 * a guide entry (or a removed command still documented) is caught at CI. The
 * guide cannot silently lie to the agent.
 *
 * The guide does NOT carry full arg schemas (those live in the typed
 * `CommandPayloads` / the mutation handlers) — it carries the contract the agent
 * reasons over. For exact arg validation, the apply tool checks against
 * the typed payload at the seam; for exact arg shapes the agent falls back to
 * source.
 */

/** One command's agent-facing contract. */
export interface CommandGuideEntry {
  /** The `cmd()` command name — what the apply tool dispatches on. */
  name: string;
  /** Logical group for navigation. */
  group:
    | "dataSource"
    | "dataTable"
    | "field"
    | "metric"
    | "insight"
    | "visualization"
    | "dashboard"
    | "node";
  /** One-line effect summary. */
  summary: string;
  /** Argument names → terse type/role. The contract, not the full schema. */
  args: Record<string, string>;
  /** Cautions the agent must heed (idempotency, validation, side effects). */
  notes?: string;
}

/**
 * The crafted guide. Ordered by group for readability. Names MUST match the
 * `cmd()` command names exactly (the freshness test enforces this against
 * COMMAND_PATHS).
 */
export const COMMAND_GUIDE: readonly CommandGuideEntry[] = [
  // --- DataSource ---
  {
    name: "GetOrCreateDataSource",
    group: "dataSource",
    summary: "Idempotent upsert of a data source by client-minted id.",
    args: { id: "UUID", type: "connector id", name: "display name" },
    notes: "Safe to retry — finds existing by PK or inserts. No credentials.",
  },
  {
    name: "CreateDataSource",
    group: "dataSource",
    summary: "Create a data source, storing any credentials in the vault.",
    args: {
      id: "UUID",
      type: "connector id",
      name: "display name",
      "apiKey?": "secret",
      "connectionString?": "secret",
    },
    notes: "Credentials go to the vault; never echoed back on read.",
  },
  {
    name: "SetDataSourceConfig",
    group: "dataSource",
    summary: "Replace a data source's credential + non-credential config.",
    args: {
      id: "UUID",
      "apiKey?": "secret",
      "connectionString?": "secret",
      "extra?": "non-credential settings",
    },
    notes: "`extra` must NOT contain apiKey/connectionString (rejected).",
  },
  // --- DataTable ---
  {
    name: "CreateDataTable",
    group: "dataTable",
    summary: "Create a data table under a data source.",
    args: {
      id: "UUID",
      dataSourceId: "UUID",
      name: "display name",
      table: "source table name",
      "sourceSchema?": "discovered schema",
      "fields?": "Field[]",
      "metrics?": "Metric[]",
      "dataFrameId?": "UUID",
    },
  },
  {
    name: "SetDataTableSchema",
    group: "dataTable",
    summary: "Replace a data table's discovered source schema.",
    args: { id: "UUID", sourceSchema: "discovered schema" },
  },
  {
    name: "RefreshDataTable",
    group: "dataTable",
    summary: "Point a data table at a new dataframe and stamp lastFetchedAt.",
    args: { id: "UUID", dataFrameId: "UUID" },
  },
  // --- Field (polymorphic: nodeId targets a DataTable or an Insight) ---
  {
    name: "AddField",
    group: "field",
    summary: "Append a field to a data table (or select it on an insight).",
    args: { nodeId: "UUID (table|insight)", field: "Field" },
    notes: "Rejects a duplicate field id.",
  },
  {
    name: "UpdateField",
    group: "field",
    summary: "Update a field by id on a data table.",
    args: {
      nodeId: "UUID (table)",
      fieldId: "UUID",
      updates: "Partial<Field>",
    },
    notes: "Rejected on insight nodes — insight fields are inherited.",
  },
  {
    name: "RemoveField",
    group: "field",
    summary: "Remove a field by id.",
    args: { nodeId: "UUID (table|insight)", fieldId: "UUID" },
    notes: "Rejects a missing id.",
  },
  // --- Metric (polymorphic via nodeId) ---
  {
    name: "AddMetric",
    group: "metric",
    summary: "Add a metric to a data table or insight.",
    args: { nodeId: "UUID (table|insight)", metric: "Metric | InsightMetric" },
    notes:
      "Insight metrics carry `sourceTable`; table metrics carry `tableId`. " +
      "The handler validates the shape for the insight path.",
  },
  {
    name: "UpdateMetric",
    group: "metric",
    summary: "Update a metric by id.",
    args: {
      nodeId: "UUID (table|insight)",
      metricId: "UUID",
      updates: "Partial<Metric>",
    },
  },
  {
    name: "RemoveMetric",
    group: "metric",
    summary: "Remove a metric by id.",
    args: { nodeId: "UUID (table|insight)", metricId: "UUID" },
    notes: "Rejects a missing id.",
  },
  // --- Insight ---
  {
    name: "CreateInsight",
    group: "insight",
    summary: "Create an insight over a data table or another insight.",
    args: {
      id: "UUID",
      name: "display name",
      source: "{ sourceType: 'dataTable'|'insight', sourceId: UUID }",
      "selectedFields?": "UUID[]",
      "metrics?": "InsightMetric[] (sourceTable, not tableId)",
    },
    notes: "Validates source exists; rejects self-reference cycles.",
  },
  {
    name: "SetInsightSource",
    group: "insight",
    summary: "Re-point an insight's source.",
    args: {
      id: "UUID",
      source: "{ sourceType: 'dataTable'|'insight', sourceId: UUID }",
    },
    notes: "Validates existence + cycle detection.",
  },
  {
    name: "SelectFields",
    group: "insight",
    summary: "Replace-all the insight's selected dimension field ids.",
    args: { id: "UUID", fieldIds: "UUID[]" },
  },
  {
    name: "SetInsightFilter",
    group: "insight",
    summary: "Replace-all the insight's filter predicates.",
    args: {
      id: "UUID",
      filters:
        "TypedInsightFilter[] — value is { kind:'value', v } | { kind:'lateBound', ref }",
    },
    notes: "v: null means IS NULL. lateBound defers binding to publish.",
  },
  {
    name: "SetInsightSort",
    group: "insight",
    summary: "Replace-all the insight's sort order.",
    args: { id: "UUID", sorts: "InsightSort[] ({ field, direction })" },
  },
  {
    name: "AddJoin",
    group: "insight",
    summary: "Append a join to an insight.",
    args: {
      id: "UUID",
      join: "{ type, rightTableId: UUID, leftKey, rightKey }",
    },
    notes: "Validates rightTableId resolves to a data table.",
  },
  {
    name: "UpdateJoin",
    group: "insight",
    summary: "Edit the join at an array index.",
    args: { id: "UUID", joinIndex: "number", updates: "Partial<join>" },
  },
  {
    name: "RemoveJoin",
    group: "insight",
    summary: "Drop the join at an array index.",
    args: { id: "UUID", joinIndex: "number" },
  },
  // --- Visualization ---
  {
    name: "CreateVisualization",
    group: "visualization",
    summary: "Create a chart over an insight.",
    args: {
      id: "UUID",
      name: "display name",
      insightId: "UUID",
      visualizationType: "chart type",
      spec: "Vega-Lite spec",
      "encoding?": "field→channel encoding",
    },
    notes: "The `data` key is stripped from spec before storage.",
  },
  {
    name: "SetChartType",
    group: "visualization",
    summary: "Change a chart's type.",
    args: { id: "UUID", visualizationType: "chart type" },
  },
  {
    name: "SetChartEncoding",
    group: "visualization",
    summary: "Set a chart's field→channel encoding (and optionally the spec).",
    args: {
      id: "UUID",
      encoding: "field→channel encoding",
      "spec?": "Vega-Lite spec (omit to leave untouched)",
    },
  },
  // --- Dashboard ---
  {
    name: "CreateDashboard",
    group: "dashboard",
    summary: "Create an empty dashboard.",
    args: { id: "UUID", name: "display name", "description?": "text" },
  },
  {
    name: "AddDashboardItem",
    group: "dashboard",
    summary: "Place a viz panel or markdown block on a dashboard.",
    args: {
      dashboardId: "UUID",
      item: "{ id, type:'visualization'|'markdown', visualizationId?|content?, x,y,width,height }",
    },
    notes: "Rejects a duplicate item id.",
  },
  {
    name: "UpdateDashboardItem",
    group: "dashboard",
    summary: "Move / resize / edit one dashboard item.",
    args: {
      dashboardId: "UUID",
      itemId: "UUID",
      updates: "Partial item (id and type are pinned, not editable)",
    },
    notes: "Rejects a missing itemId.",
  },
  {
    name: "SetDashboardLayout",
    group: "dashboard",
    summary: "Replace-all the dashboard layout (bulk rearrange).",
    args: { dashboardId: "UUID", items: "DashboardItemInput[]" },
    notes: "Rejects duplicate item ids.",
  },
  {
    name: "RemoveDashboardItem",
    group: "dashboard",
    summary: "Remove one panel from a dashboard.",
    args: { dashboardId: "UUID", itemId: "UUID" },
    notes: "Rejects a missing itemId.",
  },
  // --- Cross-cutting (polymorphic over artifact kinds) ---
  {
    name: "RenameNode",
    group: "node",
    summary: "Rename any artifact (table, source, insight, viz, dashboard).",
    args: { id: "UUID", name: "new name" },
    notes:
      "Polymorphic — probes kinds in a fixed order and renames the first hit.",
  },
  {
    name: "DeleteNode",
    group: "node",
    summary: "Delete any artifact, cascading through ownership edges.",
    args: { id: "UUID" },
    notes:
      "Cascades ownership edges (source→table); stops at reference edges and " +
      "reports orphanedNodes for drift-repair.",
  },
] as const;

/**
 * The set of command names the guide documents — the FRESHNESS ANCHOR. The
 * apps/server freshness test asserts this exactly equals the live registry's
 * command names (COMMAND_PATHS keys), so the guide can neither omit a real
 * command nor document a removed one without failing CI.
 */
export const GUIDE_COMMAND_NAMES: ReadonlySet<string> = new Set(
  COMMAND_GUIDE.map((e) => e.name),
);

/**
 * Render the guide as a compact text block for injection into the agent's
 * context (the PRIMARY reference the apply tool hands the model). Source-backup
 * remains reachable via `readSource("apps/server/src/functions/commands.ts")`.
 */
export function renderCommandGuide(): string {
  const lines: string[] = [
    "# Command vocabulary (primary reference)",
    "Each command is applied via the apply tool by `name`. For exact arg",
    "schemas, fall back to source: apps/server/src/functions/commands.ts.",
    "",
  ];
  let group = "";
  for (const e of COMMAND_GUIDE) {
    if (e.group !== group) {
      group = e.group;
      lines.push(`## ${group}`);
    }
    const args = Object.entries(e.args)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`- ${e.name} — ${e.summary}`);
    lines.push(`  args: { ${args} }`);
    if (e.notes) lines.push(`  note: ${e.notes}`);
  }
  return lines.join("\n");
}

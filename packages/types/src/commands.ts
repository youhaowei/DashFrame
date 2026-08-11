/**
 * Client-safe command vocabulary — typed builders the UI and agent both use
 * to assemble `{ path, args }` envelopes for `commitBatch` / `previewDiff`.
 *
 * Lives in `@dashframe/types` (no server/Drizzle/vault imports) so the renderer
 * can import `cmd` without pulling the server module graph into the bundle.
 * `apps/server/src/functions/commands.ts` re-exports these and owns the
 * mutation handlers + `commandFunctions` registry only.
 */
import type { Field, SourceSchema } from "./field";
import type {
  Insight,
  InsightFilter,
  InsightJoinConfig,
  InsightRuntimeDeclaration,
  InsightSort,
} from "./insights";
import type { InsightMetric, Metric } from "./metric";
import type { UUID } from "./uuid";
import type {
  VegaLiteSpec,
  Visualization,
  VisualizationEncoding,
  VisualizationType,
} from "./visualizations";

// ---------------------------------------------------------------------------
// Envelope (mirrors @wystack/server `Command` — kept local so this package
// stays dependency-free)
// ---------------------------------------------------------------------------

/**
 * One command in a batch. `path` is the registry path the handler is
 * registered under; `args` is the typed payload (opaque at this layer).
 */
export interface Command {
  id?: string;
  path: string;
  args: unknown;
}

/**
 * One command's outcome in a `commitBatch` / `applyCommands` result.
 * Parallel to the `commands` array: `results[i]` pairs with `commands[i]`.
 */
export interface CommandResult {
  id?: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// Operand / source / dashboard input shapes
// ---------------------------------------------------------------------------

/**
 * Emitter provenance for artifact creates. Same shape as
 * `@dashframe/server-core`'s `ArtifactProvenance` — duplicated here so the
 * types package stays free of server-core.
 */
export type ArtifactProvenance = {
  kind: "user" | "agent";
  id?: string;
  runId?: string;
};

/**
 * Polymorphic source for Insight commands (DataTable or another Insight).
 */
export type InsightSourceInput =
  | { sourceType: "dataTable"; sourceId: UUID }
  | { sourceType: "insight"; sourceId: UUID };

/**
 * A filter predicate value operand — tagged union (discriminant required).
 * `kind: 'value'`    → the author supplied the literal (v: null = IS NULL).
 * `kind: 'lateBound'` → the egress gate withheld the value; bound at publish.
 */
export type FilterOperandValue =
  | { kind: "value"; v: unknown }
  | { kind: "lateBound"; ref: LateBoundRef };

/**
 * Late-bound reference forms (spec: Artifact API, Operand value-binding).
 */
export type LateBoundRef =
  | { type: "column"; fieldId: UUID }
  | { type: "category"; handle: string }
  | { type: "placeholder"; prompt: string };

/**
 * A filter predicate where the value operand is a FilterOperandValue.
 * Mirrors InsightFilter from domain types but with the typed operand.
 *
 * No `between` operator: the operand model here is scalar (`v: unknown`), and
 * a range/"between" value can't be expressed by a single scalar. Extending
 * this to support ranges is out of scope — see the UI-side note in
 * InsightConfigPanel.tsx's filter handlers, which stay on the legacy
 * `updateInsight` write path for exactly this reason.
 */
export interface TypedInsightFilter {
  /** Stable identity preserved across UI round-trips when present. */
  id?: string;
  field: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  value: FilterOperandValue;
}

/**
 * Filter override for a single dashboard item.
 */
export interface DashboardItemFilterOverride {
  field: string;
  operator:
    | "eq"
    | "ne"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "in"
    | "between";
  value: unknown;
  cleared?: boolean;
}

/** Override bag for a dashboard item (instrument-level overrides). */
export interface DashboardItemOverridesInput {
  filters?: DashboardItemFilterOverride[];
  sorts?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
}

/** A Dashboard item as supplied in AddDashboardItem / SetDashboardLayout. */
export interface DashboardItemInput {
  id: UUID;
  type: "visualization" | "markdown";
  visualizationId?: UUID;
  content?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  overrides?: DashboardItemOverridesInput;
}

// ---------------------------------------------------------------------------
// Command payloads + names + paths
// ---------------------------------------------------------------------------

/**
 * Typed payloads for each command. Intent-carrying messages the human UI and
 * the agent both construct; `COMMAND_PATHS` lowers them to the `{ path, args }`
 * envelope `applyCommands` dispatches.
 */
export interface CommandPayloads {
  // DataSource
  GetOrCreateDataSource: { id: UUID; type: string; name: string };
  CreateDataSource: {
    id: UUID;
    type: string;
    name: string;
    apiKey?: string;
    connectionString?: string;
    /** Provenance of the emitter — `{ kind: "agent" }` for agent-authored. */
    createdBy?: ArtifactProvenance;
  };
  SetDataSourceConfig: {
    id: UUID;
    apiKey?: string;
    connectionString?: string;
    /** Non-credential connector settings. Must not include 'apiKey' or 'connectionString'. */
    extra?: Record<string, unknown>;
  };
  // DataTable
  CreateDataTable: {
    id: UUID;
    dataSourceId: UUID;
    name: string;
    table: string;
    sourceSchema?: SourceSchema;
    fields?: Field[];
    metrics?: Metric[];
    dataFrameId?: UUID;
  };
  SetDataTableSchema: { id: UUID; sourceSchema: SourceSchema };
  RefreshDataTable: { id: UUID; dataFrameId: UUID };
  // Fields & Metrics (targets DataTable or Insight via nodeId)
  AddField: { nodeId: UUID; field: Field };
  UpdateField: { nodeId: UUID; fieldId: UUID; updates: Partial<Field> };
  RemoveField: { nodeId: UUID; fieldId: UUID };
  AddMetric: { nodeId: UUID; metric: Metric | InsightMetric };
  UpdateMetric: { nodeId: UUID; metricId: UUID; updates: Partial<Metric> };
  RemoveMetric: { nodeId: UUID; metricId: UUID };
  // Insight
  CreateInsight: {
    id: UUID;
    name: string;
    source: InsightSourceInput;
    selectedFields?: UUID[];
    metrics?: InsightMetric[];
  };
  SetInsightSource: { id: UUID; source: InsightSourceInput };
  SelectFields: { id: UUID; fieldIds: UUID[] };
  SetInsightFilter: {
    id: UUID;
    /** UI-authored literals stay in their domain shape; agent operands remain explicitly tagged. */
    filters: Array<InsightFilter | TypedInsightFilter>;
  };
  SetInsightSort: { id: UUID; sorts: InsightSort[] };
  SetInsightRuntimeControls: {
    id: UUID;
    runtimeControls?: InsightRuntimeDeclaration;
  };
  AddJoin: { id: UUID; join: InsightJoinConfig };
  UpdateJoin: {
    id: UUID;
    joinIndex: number;
    updates: Partial<InsightJoinConfig>;
  };
  RemoveJoin: { id: UUID; joinIndex: number };
  // Visualization
  CreateVisualization: {
    id: UUID;
    name: string;
    insightId: UUID;
    visualizationType: VisualizationType;
    spec: VegaLiteSpec;
    encoding?: VisualizationEncoding;
  };
  SetChartType: { id: UUID; visualizationType: VisualizationType };
  SetChartEncoding: {
    id: UUID;
    encoding: VisualizationEncoding;
    spec?: VegaLiteSpec;
  };
  // Dashboard
  CreateDashboard: { id: UUID; name: string; description?: string };
  AddDashboardItem: { dashboardId: UUID; item: DashboardItemInput };
  UpdateDashboardItem: {
    dashboardId: UUID;
    itemId: UUID;
    updates: Partial<Omit<DashboardItemInput, "id" | "type">>;
  };
  SetDashboardLayout: { dashboardId: UUID; items: DashboardItemInput[] };
  RemoveDashboardItem: { dashboardId: UUID; itemId: UUID };
  FanOutDashboardItems: {
    dashboardId: UUID;
    sourceItemId: UUID;
    field: string;
    placements: {
      id: UUID;
      value: unknown;
      x: number;
      y: number;
      width?: number;
      height?: number;
    }[];
  };
  // Cross-cutting
  RenameNode: { id: UUID; name: string };
  DeleteNode: { id: UUID };
}

export type CommandName = keyof CommandPayloads;

/**
 * Map a command name to the registry path its backing mutation is registered
 * under. Single source of truth tying the typed vocabulary to the dispatch path.
 */
export const COMMAND_PATHS = {
  GetOrCreateDataSource: "getOrCreateDataSource",
  CreateDataSource: "createDataSource",
  SetDataSourceConfig: "setDataSourceConfig",
  CreateDataTable: "createDataTable",
  SetDataTableSchema: "setDataTableSchema",
  RefreshDataTable: "refreshDataTableCmd",
  AddField: "addField",
  UpdateField: "updateField",
  RemoveField: "removeField",
  AddMetric: "addMetric",
  UpdateMetric: "updateMetric",
  RemoveMetric: "removeMetric",
  CreateInsight: "createInsightCmd",
  SetInsightSource: "setInsightSource",
  SelectFields: "selectFields",
  SetInsightFilter: "setInsightFilter",
  SetInsightSort: "setInsightSort",
  SetInsightRuntimeControls: "setInsightRuntimeControls",
  AddJoin: "addJoin",
  UpdateJoin: "updateJoin",
  RemoveJoin: "removeJoin",
  CreateVisualization: "createVisualizationCmd",
  SetChartType: "setChartType",
  SetChartEncoding: "setChartEncoding",
  CreateDashboard: "createDashboardCmd",
  AddDashboardItem: "addDashboardItemCmd",
  UpdateDashboardItem: "updateDashboardItemCmd",
  SetDashboardLayout: "setDashboardLayout",
  RemoveDashboardItem: "removeDashboardItemCmd",
  FanOutDashboardItems: "fanOutDashboardItemsCmd",
  RenameNode: "renameNode",
  DeleteNode: "deleteNode",
} as const satisfies { [K in CommandName]: string };

export type CommandRegistryPath = (typeof COMMAND_PATHS)[CommandName];

/**
 * Build one `Command` envelope from a typed payload. `cmd("AddField", {...})`
 * gives compile-time checking of the payload AND the right dispatch path.
 */
export function cmd<K extends CommandName>(
  name: K,
  payload: CommandPayloads[K],
): Command {
  return { path: COMMAND_PATHS[name], args: payload };
}

// ---------------------------------------------------------------------------
// UI helpers — decompose coarse domain patches into command batches
// ---------------------------------------------------------------------------

/**
 * Shallow value comparison for metric records. Key-order sensitive (it is just
 * JSON), which can only ever report a false CHANGE, never a false match — a
 * redundant rebuild, not a lost edit.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * True when `next` drops a key that `previous` had set.
 *
 * `UpdateMetric` merges its `updates` onto the stored metric, and JSON drops
 * `undefined` values on the wire — so an edit that CLEARS a field (switching
 * `sum(amount)` to `count(*)` sets `columnName: undefined`) would arrive as an
 * update that never mentions the field, leaving the old value in place. Such an
 * edit has to be expressed as a rebuild instead of a merge.
 */
function clearsAKey(previous: InsightMetric, next: InsightMetric): boolean {
  return Object.entries(previous).some(
    ([key, value]) =>
      value !== undefined &&
      (next as unknown as Record<string, unknown>)[key] === undefined,
  );
}

/**
 * Diff two metric lists into Add/Update/Remove commands (one batch).
 * Rebuilds via remove-all + add-all when order changes with the same id set
 * (UpdateMetric is in-place and cannot reorder), and when any edit clears a
 * field (a merge cannot express a removal — see `clearsAKey`).
 */
export function buildMetricDiffCommands(
  nodeId: UUID,
  previous: readonly InsightMetric[],
  next: readonly InsightMetric[],
): Command[] {
  const prevById = new Map(previous.map((m) => [m.id, m]));
  const nextById = new Map(next.map((m) => [m.id, m]));
  const prevIds = previous.map((m) => m.id);
  const nextIds = next.map((m) => m.id);

  const sameSet =
    prevIds.length === nextIds.length &&
    prevIds.every((id) => nextById.has(id));
  const orderChanged = sameSet && prevIds.some((id, i) => id !== nextIds[i]);
  const clearsAField = next.some((m) => {
    const prev = prevById.get(m.id);
    return prev !== undefined && clearsAKey(prev, m);
  });

  const commands: Command[] = [];

  if (orderChanged || clearsAField) {
    for (let i = previous.length - 1; i >= 0; i--) {
      commands.push(cmd("RemoveMetric", { nodeId, metricId: previous[i]!.id }));
    }
    for (const metric of next) {
      commands.push(cmd("AddMetric", { nodeId, metric }));
    }
    return commands;
  }

  for (const m of previous) {
    if (!nextById.has(m.id)) {
      commands.push(cmd("RemoveMetric", { nodeId, metricId: m.id }));
    }
  }
  for (const m of next) {
    const prev = prevById.get(m.id);
    if (!prev) {
      commands.push(cmd("AddMetric", { nodeId, metric: m }));
    } else if (!jsonEqual(prev, m)) {
      const { id: _id, ...updates } = m;
      commands.push(
        cmd("UpdateMetric", {
          nodeId,
          metricId: m.id,
          updates: updates as Partial<Metric>,
        }),
      );
    }
  }
  return commands;
}

/**
 * Decompose a coarse insight patch (legacy `updateInsight` shape) into the
 * minimal command batch for the slices present in `updates`.
 *
 * Requires `current` for the metric diff. Slices without a corresponding
 * command (e.g. unknown keys) are ignored — callers should only pass known
 * domain fields.
 *
 * `filters` and `joins` are deliberately NOT handled here and throw rather than
 * being dropped, so a future caller cannot lose a write silently:
 *   - filters stay on the legacy `updateInsight` write path until the filter
 *     command model supports ranges (`between` has no single-scalar operand).
 *   - joins are edited through explicit `cmd("AddJoin")` / `cmd("RemoveJoin")`
 *     at the call site, which knows the user's intent better than an
 *     array diff can infer it.
 */
export function buildInsightUpdateCommands(
  id: UUID,
  current: Pick<Insight, "metrics">,
  updates: Partial<Omit<Insight, "id" | "createdAt">>,
): Command[] {
  const commands: Command[] = [];

  if (updates.name !== undefined) {
    commands.push(cmd("RenameNode", { id, name: updates.name }));
  }
  if (updates.selectedFields !== undefined) {
    commands.push(
      cmd("SelectFields", { id, fieldIds: updates.selectedFields }),
    );
  }
  if (updates.filters !== undefined) {
    throw new Error(
      "buildInsightUpdateCommands: filters are not supported — use the legacy updateInsight write path",
    );
  }
  if (updates.sorts !== undefined) {
    commands.push(cmd("SetInsightSort", { id, sorts: updates.sorts }));
  }
  if (updates.metrics !== undefined) {
    commands.push(
      ...buildMetricDiffCommands(id, current.metrics ?? [], updates.metrics),
    );
  }
  if ("runtimeControls" in updates) {
    commands.push(
      cmd("SetInsightRuntimeControls", {
        id,
        runtimeControls: updates.runtimeControls,
      }),
    );
  }
  if (updates.joins !== undefined) {
    throw new Error(
      'buildInsightUpdateCommands: joins are not supported — use cmd("AddJoin") / cmd("RemoveJoin") directly',
    );
  }
  if (updates.baseTableId !== undefined) {
    throw new Error(
      'buildInsightUpdateCommands: baseTableId cannot be repointed here — use cmd("SetInsightSource") directly',
    );
  }

  return commands;
}

/**
 * Decompose a coarse visualization patch into RenameNode / SetChartType /
 * SetChartEncoding as needed. One user edit → one commands array.
 */
export function buildVisualizationUpdateCommands(
  id: UUID,
  updates: Partial<
    Pick<Visualization, "name" | "visualizationType" | "encoding" | "spec">
  >,
): Command[] {
  const commands: Command[] = [];
  if (updates.name !== undefined) {
    commands.push(cmd("RenameNode", { id, name: updates.name }));
  }
  if (updates.visualizationType !== undefined) {
    commands.push(
      cmd("SetChartType", {
        id,
        visualizationType: updates.visualizationType,
      }),
    );
  }
  if (updates.encoding !== undefined || updates.spec !== undefined) {
    // SetChartEncoding requires encoding; when only spec is patched, pass the
    // empty object only if encoding is also undefined — callers that only
    // change encoding always supply it. Spec-only is rare; require encoding.
    if (updates.encoding === undefined) {
      throw new Error(
        "buildVisualizationUpdateCommands: encoding is required when setting spec",
      );
    }
    commands.push(
      cmd("SetChartEncoding", {
        id,
        encoding: updates.encoding,
        ...(updates.spec !== undefined ? { spec: updates.spec } : {}),
      }),
    );
  }
  return commands;
}

/**
 * Path-match a command result out of a commitBatch response.
 * Prefer this over index-match so the lookup stays correct if the batch
 * gains leading commands later.
 *
 * PRECONDITION: the path must occur at most once in the batch. This returns
 * the FIRST match, so a batch containing two commands on the same path would
 * silently hand back the wrong result. Every current caller builds a batch
 * with a unique path per lookup.
 *
 * This is a stopgap. Correlating a result to the command that produced it by
 * name — the framework's `Command.id` — is the mechanism that removes the
 * precondition entirely, and is the intended follow-up. Do not add a second
 * same-path command to a batch that is read back this way until then.
 */
export function resultValueByCommandPath(
  batch: {
    commands: readonly Command[];
    results: readonly CommandResult[];
  },
  path: string,
): unknown {
  const index = batch.commands.findIndex((c) => c.path === path);
  if (index < 0) {
    throw new Error(
      `commitBatch result: no command with path "${path}" in batch`,
    );
  }
  return batch.results[index]?.value;
}

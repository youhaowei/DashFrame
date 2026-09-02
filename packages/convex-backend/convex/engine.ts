import { stable } from "./values";
import {
  COMMAND_PATHS,
  isUnmodifiedDraft,
  validateVisualizationEncoding,
  type VisualizationEncoding,
} from "@dashframe/types";
import {
  artifactTables,
  artifactKinds,
  type ArtifactRow,
  type ArtifactTable,
} from "./model";
import {
  clean,
  record,
  type Json,
  type ObjectValue,
  type Command,
} from "./values";
import { parseStoredDataTableState } from "./tableCodec";
import { parseStoredDashboardState } from "./dashboardCodec";
import {
  storedInsightDefinitionSchema,
  runtimeControlsSchema,
} from "./insightCodec";
export type Graph = Map<ArtifactTable, Map<string, ArtifactRow>>;
export function emptyGraph(): Graph {
  return new Map(artifactTables.map((t) => [t, new Map()]));
}
export function cloneGraph(graph: Graph): Graph {
  return new Map(
    [...graph].map(([t, rows]) => [
      t,
      new Map([...rows].map(([id, row]) => [id, clean(row)])),
    ]),
  );
}
export function get(
  graph: Graph,
  table: ArtifactTable,
  id: string,
): ArtifactRow {
  const row = graph.get(table)!.get(id);
  if (!row) throw new Error(`${artifactKinds[table]} ${id} not found`);
  return row;
}
function str(value: Json | undefined, label: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`${label} must be a non-empty string`);
  return value;
}
function array(value: Json | undefined, label: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function objects(value: Json | undefined, label: string): ObjectValue[] {
  return array(value, label).map(record);
}
function id(value: Json | undefined, label = "id"): string {
  const s = str(value, label);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  )
    throw new Error(`${label} must be a UUID`);
  return s;
}
function definition(row: ArtifactRow): ObjectValue {
  return clean(
    storedInsightDefinitionSchema.parse(row.definition),
  ) as unknown as ObjectValue;
}
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
export function changes(before: Graph, after: Graph) {
  return artifactTables.flatMap((table) =>
    [
      ...new Set([...before.get(table)!.keys(), ...after.get(table)!.keys()]),
    ].flatMap((id) => {
      const base = before.get(table)!.get(id) ?? null;
      const value = after.get(table)!.get(id) ?? null;
      return same(base, value) ? [] : [{ table, id, base, value }];
    }),
  );
}
function requireSource(graph: Graph, source: ObjectValue, current?: string) {
  const type = str(source.sourceType, "sourceType");
  if (type !== "insight" && type !== "dataTable")
    throw new Error("Invalid source type");
  let row = get(
    graph,
    type === "insight" ? "insights" : "dataTables",
    id(source.sourceId, "sourceId"),
  );
  const seen = new Set<string>(current ? [current] : []);
  while (type === "insight") {
    if (seen.has(row.id))
      throw new Error("Insight source would create a cycle");
    seen.add(row.id);
    const next = record(definition(row).source);
    if (next.sourceType !== "insight") break;
    row = get(graph, "insights", str(next.sourceId, "sourceId"));
  }
}
function outputFields(
  graph: Graph,
  source: ObjectValue,
  seen = new Set<string>(),
): ObjectValue[] {
  const key = str(source.sourceId, "sourceId");
  if (source.sourceType === "dataTable")
    return get(graph, "dataTables", key).fields ?? [];
  if (seen.has(key)) throw new Error("Insight source cycle");
  seen.add(key);
  const def = definition(get(graph, "insights", key));
  const fields = availableFields(graph, def, seen);
  const selected = array(def.selectedFields, "selectedFields");
  const metrics = objects(def.metrics, "metrics");
  return [
    ...fields
      .filter((f) =>
        selected.length ? selected.includes(f.id!) : metrics.length === 0,
      )
      .map((f) => ({
        ...f,
        tableId: key,
        columnName: `field_${str(f.id, "field.id").replaceAll("-", "_")}`,
      })),
    ...metrics.map((m) => ({
      id: m.id!,
      name: m.name!,
      tableId: key,
      columnName: `metric_${str(m.id, "metric.id").replaceAll("-", "_")}`,
      type: "number",
    })),
  ];
}
function availableFields(
  graph: Graph,
  def: ObjectValue,
  seen = new Set<string>(),
): ObjectValue[] {
  let fields = outputFields(graph, record(def.source), seen).filter(
    (f) => !String(f.name).startsWith("_"),
  );
  const counts = new Map<string, number>();
  for (const join of objects(def.joins ?? [], "joins")) {
    const tableId = str(join.rightTableId, "rightTableId"),
      right = get(graph, "dataTables", tableId),
      rightFields = (right.fields ?? []).filter(
        (f) => !String(f.name).startsWith("_"),
      );
    const leftKey = fields.find(
        (f) => (f.columnName ?? f.name) === join.leftKey,
      ),
      rightKey = rightFields.find(
        (f) => (f.columnName ?? f.name) === join.rightKey,
      );
    if (!leftKey || !rightKey) continue;
    const instance = counts.get(tableId) ?? 0;
    fields.push(
      ...rightFields
        .filter(
          (f) =>
            (f.columnName ?? f.name) !== (rightKey.columnName ?? rightKey.name),
        )
        .map((f) => ({ ...f, id: instance ? `${f.id}_j${instance}` : f.id! })),
    );
    counts.set(tableId, instance + 1);
  }
  return fields;
}
function validateDerived(graph: Graph, def: ObjectValue) {
  if (record(def.source).sourceType !== "insight") return;
  const fields = availableFields(graph, def);
  for (const selected of array(def.selectedFields, "selectedFields"))
    if (!fields.some((f) => f.id === selected))
      throw new Error(`Field ${selected} is not output by source Insight`);
  for (const m of objects(def.metrics, "metrics"))
    if (
      m.columnName &&
      !fields.some(
        (f) =>
          f.tableId === m.sourceTable &&
          (f.columnName ?? f.name) === m.columnName,
      )
    )
      throw new Error("Metric column is not output by source Insight");
  const columns = new Set(fields.map((f) => f.columnName ?? f.name));
  const selected = array(def.selectedFields, "selectedFields"),
    metrics = objects(def.metrics, "metrics");
  const resultColumns = new Set(
    selected.length === 0 && metrics.length === 0
      ? fields.map((f) => f.columnName ?? f.name)
      : [
          ...fields
            .filter((f) => selected.includes(f.id!))
            .map((f) => f.columnName ?? f.name),
          ...metrics.map(
            (m) => `metric_${str(m.id, "metric.id").replaceAll("-", "_")}`,
          ),
        ],
  );
  for (const m of objects(def.metrics, "metrics"))
    columns.add(`metric_${str(m.id, "metric.id").replaceAll("-", "_")}`);
  for (const f of objects(def.filters ?? [], "filters"))
    if (!columns.has(f.field))
      throw new Error("Filter field is not output by source Insight");
  for (const s of objects(def.sorts ?? [], "sorts"))
    if (!resultColumns.has(s.field))
      throw new Error("Sort field is not output by source Insight");
}
function prune(def: ObjectValue) {
  if (!def.runtimeControls) return;
  const controls = record(def.runtimeControls),
    next: ObjectValue = {};
  const filterIds = new Set(
    objects(def.filters ?? [], "filters").map((f) => f.id),
  );
  const filters = objects(controls.filters ?? [], "runtime filters").filter(
    (f) => filterIds.has(f.filterId),
  );
  if (filters.length) next.filters = filters;
  if (controls.sort) {
    const sort = record(controls.sort);
    const allowedFieldIds = array(
      sort.allowedFieldIds,
      "allowedFieldIds",
    ).filter(
      (v) =>
        array(def.selectedFields, "selectedFields").includes(v) ||
        objects(def.metrics, "metrics").some((m) => m.id === v),
    );
    if (allowedFieldIds.length) next.sort = { allowedFieldIds, maxKeys: 1 };
  }
  if (controls.limit) next.limit = controls.limit;
  if (Object.keys(next).length) def.runtimeControls = next;
  else delete def.runtimeControls;
}
function validateMetric(metric: ObjectValue, derived: boolean) {
  str(metric.id, "metric.id");
  str(metric.name, "metric.name");
  str(metric[derived ? "sourceTable" : "tableId"], "metric owner");
  if (
    !["sum", "avg", "count", "min", "max", "count_distinct"].includes(
      str(metric.aggregation, "aggregation"),
    )
  )
    throw new Error("Invalid aggregation");
  if (metric.aggregation !== "count" || metric.columnName !== undefined)
    str(metric.columnName, "columnName");
}
function validateJoin(graph: Graph, join: ObjectValue) {
  if (!["inner", "left", "right", "full"].includes(str(join.type, "join.type")))
    throw new Error("Invalid join type");
  str(join.leftKey, "leftKey");
  str(join.rightKey, "rightKey");
  get(graph, "dataTables", id(join.rightTableId, "rightTableId"));
}
function stripSpec(value: Json): Json {
  if (Array.isArray(value)) return value.map(stripSpec);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== "data" && k !== "datasets")
        .map(([k, v]) => [k, stripSpec(v)]),
    );
  return value;
}
function validateEncoding(value: Json | undefined) {
  if (value === undefined) return;
  const result = validateVisualizationEncoding(
    value as unknown as VisualizationEncoding,
  );
  if (result) throw new Error(result);
}
function safeExtra(extra: ObjectValue) {
  if (
    [
      "apiKey",
      "connectionString",
      "hasApiKey",
      "hasConnectionString",
      "sourceBindingVersion",
    ].some((k) => k in extra)
  )
    throw new Error(
      "Credential fields, credential flags, and sourceBindingVersion cannot be set through extra",
    );
  if (stable(extra).includes("secret:"))
    throw new Error("Secret references are restricted to credential slots");
}
const secretRefPattern = /^secret:[0-9a-f-]{36}$/i;
// Defines credential slots that connector commands may write after host staging.
// credentialRef is stored by assistant-provider APIs, not connector commands.
const COMMAND_WRITABLE_CREDENTIAL_SLOTS = [
  "apiKey",
  "connectionString",
] as const;
function assertNoInheritedCredentialExfil(
  config: ObjectValue,
  args: ObjectValue,
  extra: ObjectValue | undefined,
) {
  if (!extra || Object.keys(extra).length === 0) return;
  const inherited = Object.entries(config)
    .filter(
      ([, value]) => typeof value === "string" && secretRefPattern.test(value),
    )
    .map(([key]) => key);
  const carried = inherited.filter(
    (key) => args[key] === undefined && !(key in extra),
  );
  if (carried.length)
    throw new Error(
      `Cannot change connector configuration while carrying inherited credential(s) [${carried.join(
        ", ",
      )}] without re-affirming or clearing them`,
    );
}
function configEdit(
  config: ObjectValue,
  args: ObjectValue,
  host: boolean,
  protectInheritedCredentials = false,
) {
  const credentials: [string, string][] = [];
  for (const k of COMMAND_WRITABLE_CREDENTIAL_SLOTS) {
    if (args[k] === undefined) continue;
    const value = args[k];
    if (typeof value !== "string")
      throw new Error("Credential must be a string");
    if (!host) throw new Error("Credentials must be staged through the host");
    if (value && !secretRefPattern.test(value))
      throw new Error("Only staged SecretRefs may be persisted");
    credentials.push([k, value]);
  }
  const extra = args.extra ? record(args.extra) : undefined;
  if (extra) safeExtra(extra);
  if (protectInheritedCredentials)
    assertNoInheritedCredentialExfil(config, args, extra);
  for (const [k, value] of credentials) {
    if (value) config[k] = value;
    else delete config[k];
  }
  if (extra) Object.assign(config, extra);
}
export function execute(
  graph: Graph,
  commands: Command[],
  workspaceId: string,
  now: number,
  options: { host?: boolean; service?: boolean } = {},
) {
  if (commands.length > 200)
    throw new Error("A batch is limited to 200 commands");
  const results: { id?: string; value: Json }[] = [];
  for (const command of commands) {
    if (
      !Object.values(COMMAND_PATHS).includes(
        command.path as (typeof COMMAND_PATHS)[keyof typeof COMMAND_PATHS],
      )
    )
      throw new Error(`Unknown command ${command.path}`);
    const value = run(graph, command, workspaceId, now, options);
    results.push(clean({ ...(command.id ? { id: command.id } : {}), value }));
  }
  return results;
}
function run(
  graph: Graph,
  command: Command,
  workspaceId: string,
  now: number,
  options: { host?: boolean; service?: boolean },
): Json {
  const a = record(command.args),
    p = command.path;
  if (
    options.service &&
    (["apiKey", "connectionString"].some((k) => a[k] !== undefined) ||
      p === "refreshDataTableCmd")
  )
    throw new Error("Service principal cannot perform this command");
  const create = (table: ArtifactTable, attrs: Partial<ArtifactRow>) => {
    const key = id(a.id);
    if (graph.get(table)!.has(key))
      throw new Error(`${artifactKinds[table]} ${key} already exists`);
    const row = {
      workspaceId,
      id: key,
      name: str(a.name, "name"),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      ...attrs,
    };
    graph.get(table)!.set(key, row);
    return { id: key };
  };
  const find = () => {
    const key = id(a.id);
    for (const t of artifactTables) {
      const row = graph.get(t)!.get(key);
      if (row) return { t, row };
    }
    throw new Error(`Node ${key} not found`);
  };
  if (p === "getOrCreateDataSource" || p === "createDataSource") {
    const existing = graph.get("dataSources")!.get(id(a.id));
    if (existing && p === "getOrCreateDataSource") return { id: existing.id };
    const type = str(a.type, "type"),
      config: ObjectValue =
        type === "googleAnalytics" ? { sourceBindingVersion: "v2" } : {};
    configEdit(config, a, options.host ?? false);
    return create("dataSources", {
      kind: type,
      storage: "live",
      config,
      createdBy: a.createdBy
        ? record(a.createdBy)
        : { kind: options.service ? "agent" : "user" },
    });
  }
  if (p === "setDataSourceConfig") {
    const row = get(graph, "dataSources", id(a.id));
    const config = { ...row.config };
    // Persisted rows have positive revisions. Revision zero identifies a source
    // created only in this batch/draft, whose credential came from this caller
    // rather than being inherited from canonical state.
    configEdit(config, a, options.host ?? false, row.revision > 0);
    row.config = config;
    return { ok: true };
  }
  if (p === "createDataTable") {
    get(graph, "dataSources", id(a.dataSourceId, "dataSourceId"));
    if (a.dataFrameId) get(graph, "dataFrames", id(a.dataFrameId));
    const state = clean(parseStoredDataTableState(a, "CreateDataTable"));
    return create("dataTables", {
      dataSourceId: id(a.dataSourceId),
      table: str(a.table, "table"),
      sourceSchema: (state.sourceSchema ?? null) as unknown as Json,
      fields: state.fields as unknown as ObjectValue[],
      metrics: state.metrics as unknown as ObjectValue[],
      dataFrameId: a.dataFrameId ? str(a.dataFrameId, "dataFrameId") : null,
    });
  }
  if (p === "setDataTableSchema") {
    const row = get(graph, "dataTables", id(a.id));
    parseStoredDataTableState({ ...row, sourceSchema: a.sourceSchema }, p);
    row.sourceSchema = a.sourceSchema!;
    return { ok: true };
  }
  if (p === "refreshDataTableCmd") {
    const row = get(graph, "dataTables", id(a.id));
    get(graph, "dataFrames", id(a.dataFrameId));
    row.dataFrameId = str(a.dataFrameId, "dataFrameId");
    row.lastFetchedAt = now;
    return { ok: true };
  }
  if (p === "getOrCreateInsightDraft" || p === "createInsightCmd") {
    const source = record(a.source);
    if (p === "getOrCreateInsightDraft") {
      if (source.sourceType !== "dataTable")
        throw new Error("GetOrCreateInsightDraft source must be a DataTable");
      requireSource(graph, source);
      const existing = [...graph.get("insights")!.values()].find((row) => {
        const def = storedInsightDefinitionSchema.parse(row.definition);
        return (
          def.source.sourceType === "dataTable" &&
          def.source.sourceId === source.sourceId &&
          isUnmodifiedDraft(def)
        );
      });
      if (existing) return { id: existing.id };
    }
    requireSource(graph, source, id(a.id));
    const def: ObjectValue = {
      source,
      selectedFields: a.selectedFields ?? [],
      metrics: a.metrics ?? [],
      filters: [],
      sorts: [],
      joins: [],
    };
    storedInsightDefinitionSchema.parse(def);
    for (const metric of objects(def.metrics, "metrics"))
      validateMetric(metric, true);
    validateDerived(graph, def);
    return create("insights", {
      definition: def,
      createdBy: { kind: options.service ? "agent" : "user" },
    });
  }
  if (
    [
      "setInsightSource",
      "selectFields",
      "setInsightFilter",
      "setInsightSort",
      "setInsightRuntimeControls",
      "addJoin",
      "updateJoin",
      "removeJoin",
    ].includes(p)
  ) {
    const row = get(graph, "insights", id(a.id));
    const def = definition(row);
    if (p === "setInsightSource") {
      requireSource(graph, record(a.source), row.id);
      def.source = record(a.source);
    }
    if (p === "selectFields") {
      const fields = array(a.fieldIds, "fieldIds");
      if (fields.some((v) => typeof v !== "string"))
        throw new Error("Invalid fieldIds");
      def.selectedFields = fields;
      prune(def);
    }
    if (p === "setInsightFilter") {
      def.filters = objects(a.filters, "filters").map((f, i) => ({
        ...f,
        id: typeof f.id === "string" ? f.id : `${row.id}:filter:${i}`,
      }));
      prune(def);
    }
    if (p === "setInsightSort") {
      def.sorts = objects(a.sorts, "sorts");
      for (const s of objects(def.sorts, "sorts")) {
        str(s.field, "field");
        if (s.direction !== "asc" && s.direction !== "desc")
          throw new Error("Invalid sort direction");
      }
    }
    if (p === "setInsightRuntimeControls") {
      if (a.runtimeControls === undefined) delete def.runtimeControls;
      else {
        runtimeControlsSchema.parse(a.runtimeControls);
        def.runtimeControls = a.runtimeControls;
        const controls = record(a.runtimeControls);
        const filters = objects(def.filters ?? [], "filters");
        if (controls.sort) {
          const allowed = array(
            record(controls.sort).allowedFieldIds,
            "allowedFieldIds",
          );
          const resultIds = new Set([
            ...array(def.selectedFields, "selectedFields"),
            ...objects(def.metrics, "metrics").map((m) => m.id),
          ]);
          if (allowed.some((field) => !resultIds.has(field)))
            throw new Error("Runtime control sort field not found");
        }
        for (const c of objects(controls.filters ?? [], "controls.filters"))
          if (!filters.some((f) => f.id === c.filterId))
            throw new Error("Runtime control references missing filter");
      }
    }
    if (p.endsWith("Join")) {
      const joins = objects(def.joins ?? [], "joins");
      if (p === "addJoin") {
        const join = record(a.join);
        validateJoin(graph, join);
        joins.push(join);
      } else {
        const index = a.joinIndex;
        if (
          typeof index !== "number" ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= joins.length
        )
          throw new Error("Join index out of range");
        if (p === "removeJoin") joins.splice(index, 1);
        else {
          const updates = record(a.updates);
          if (!Object.keys(updates).length)
            throw new Error("Updates are required");
          const join = { ...joins[index], ...updates };
          validateJoin(graph, join);
          joins[index] = join;
        }
      }
      def.joins = joins;
    }
    validateDerived(graph, def);
    row.definition = def;
    return { ok: true };
  }
  if (
    [
      "addField",
      "updateField",
      "removeField",
      "addMetric",
      "updateMetric",
      "removeMetric",
    ].includes(p)
  ) {
    const key = id(a.nodeId, "nodeId"),
      t = graph.get("dataTables")!.has(key) ? "dataTables" : "insights",
      row = get(graph, t, key),
      isField = p.endsWith("Field"),
      def = t === "insights" ? definition(row) : null;
    const collection = isField ? "fields" : "metrics";
    if (def && isField) {
      if (p === "updateField")
        throw new Error("UpdateField is not supported on an Insight");
      const selected = array(def.selectedFields, "selectedFields"),
        fieldId =
          p === "addField"
            ? str(record(a.field).id, "field.id")
            : str(a.fieldId, "fieldId"),
        at = selected.indexOf(fieldId);
      if (p === "addField") {
        if (at !== -1) throw new Error("Field already exists");
        selected.push(fieldId);
      } else {
        if (at === -1) throw new Error("Field not found");
        selected.splice(at, 1);
      }
      prune(def);
    } else {
      const list = def
        ? objects(def.metrics, "metrics")
        : [...(row[collection] ?? [])];
      const adding = p.startsWith("add"),
        removing = p.startsWith("remove"),
        item = adding ? record(a[isField ? "field" : "metric"]) : null,
        key = adding
          ? str(item!.id, "item.id")
          : str(a[isField ? "fieldId" : "metricId"], "itemId"),
        at = list.findIndex((x) => x.id === key);
      if (adding) {
        if (at !== -1) throw new Error("Item already exists");
        list.push(item!);
      } else {
        if (at === -1) throw new Error("Item not found");
        if (removing) list.splice(at, 1);
        else {
          const updates = record(a.updates);
          if (!Object.keys(updates).length)
            throw new Error("Updates are required");
          list[at] = { ...list[at], ...updates, id: key };
        }
      }
      if (!isField) for (const m of list) validateMetric(m, t === "insights");
      if (def) def.metrics = list;
      else {
        row[collection] = list;
        parseStoredDataTableState(row, p);
      }
    }
    if (def) {
      prune(def);
      validateDerived(graph, def);
      row.definition = def;
    }
    return { ok: true, target: { kind: artifactKinds[t], id: row.id } };
  }
  if (p === "createVisualizationCmd") {
    get(graph, "insights", id(a.insightId));
    validateEncoding(a.encoding);
    return create("visualizations", {
      insightId: str(a.insightId, "insightId"),
      chartType: str(a.visualizationType, "visualizationType"),
      encoding: a.encoding ?? {},
      options: { spec: stripSpec(a.spec ?? {}) },
      createdBy: { kind: "user" },
    });
  }
  if (p === "setChartType" || p === "setChartEncoding") {
    const row = get(graph, "visualizations", id(a.id));
    if (p === "setChartType")
      row.chartType = str(a.visualizationType, "visualizationType");
    else {
      validateEncoding(a.encoding);
      row.encoding = a.encoding!;
      if (a.spec !== undefined) row.options = { spec: stripSpec(a.spec) };
    }
    return { ok: true };
  }
  if (p === "createDashboardCmd")
    return create("dashboards", {
      description: typeof a.description === "string" ? a.description : null,
      layout: [],
      controls: null,
      createdBy: { kind: "user" },
    });
  if (
    [
      "addDashboardItemCmd",
      "updateDashboardItemCmd",
      "setDashboardLayout",
      "removeDashboardItemCmd",
      "patchDashboardItemOverrideCmd",
      "setDashboardControls",
      "fanOutDashboardItemsCmd",
    ].includes(p)
  )
    return dashboardCommand(graph, p, a);
  if (p === "renameNode") {
    const { t, row } = find();
    row.name = str(a.name, "name");
    return { ok: true, renamed: { kind: artifactKinds[t], id: row.id } };
  }
  if (p === "deleteNode") {
    const key = id(a.id);
    const table = (
      [
        "visualizations",
        "dashboards",
        "insights",
        "dataTables",
        "dataSources",
      ] as const
    ).find((t) => graph.get(t)!.has(key));
    if (!table) throw new Error(`Node ${key} not found`);
    const orphanedNodes = removeNode(graph, table, key);
    return {
      ok: true,
      deleted: { kind: artifactKinds[table], id: key },
      orphanedNodes,
    };
  }
  throw new Error(`Unimplemented command ${p}`);
}
function dashboardCommand(graph: Graph, p: string, a: ObjectValue): Json {
  const row = get(graph, "dashboards", id(a.dashboardId));
  let items = clean(row.layout ?? []);
  const created: string[] = [];
  const itemAt = () => {
    const index = items.findIndex((x) => x.id === a.itemId);
    if (index < 0) throw new Error("Dashboard item not found");
    return index;
  };
  if (p === "addDashboardItemCmd") items.push(record(a.item));
  if (p === "setDashboardLayout") items = objects(a.items, "items");
  if (p === "removeDashboardItemCmd") items.splice(itemAt(), 1);
  if (p === "updateDashboardItemCmd") {
    const i = itemAt(),
      old = items[i]!,
      updates = record(a.updates);
    const allowed = ["visualizationId", "content", "x", "y", "width", "height"];
    if (
      Object.keys(updates).some(
        (k) => !allowed.includes(k) && k !== "id" && k !== "type",
      )
    )
      throw new Error("Unsupported dashboard update");
    items[i] = {
      ...old,
      ...Object.fromEntries(
        Object.entries(updates).filter(([k]) => allowed.includes(k)),
      ),
      id: old.id!,
      type: old.type!,
    };
  }
  if (p === "patchDashboardItemOverrideCmd") {
    const item = items[itemAt()]!,
      patch = record(a.patch),
      overrides = { ...(item.overrides ? record(item.overrides) : {}) };
    if (patch.kind === "filter") {
      const field = str(patch.field, "field"),
        filters = objects(overrides.filters ?? [], "filters").filter(
          (f) => f.field !== field,
        );
      if (patch.value !== null) {
        const value = record(patch.value);
        if (value.field !== field) throw new Error("Filter field mismatch");
        filters.push(value);
      }
      overrides.filters = filters;
    } else if (patch.kind === "sorts" || patch.kind === "limit") {
      if (patch.value === null) delete overrides[patch.kind];
      else overrides[patch.kind] = patch.value!;
    } else throw new Error("Unknown override patch");
    if (Array.isArray(overrides.filters) && overrides.filters.length === 0)
      delete overrides.filters;
    if (Array.isArray(overrides.sorts) && overrides.sorts.length === 0)
      delete overrides.sorts;
    if (Object.keys(overrides).length) item.overrides = overrides;
    else delete item.overrides;
  }
  if (p === "setDashboardControls") row.controls = a.controls!;
  if (p === "fanOutDashboardItemsCmd") {
    const source = items.find((x) => x.id === a.sourceItemId);
    if (!source || source.type !== "visualization" || !source.visualizationId)
      throw new Error("Source must be a visualization item");
    const placements = objects(a.placements, "placements");
    if (!placements.length) throw new Error("Placements must not be empty");
    const field = str(a.field, "field");
    for (const placement of placements) {
      if (!Object.hasOwn(placement, "value"))
        throw new Error("Placement value is required");
      const key = id(placement.id);
      const overrides = clean(source.overrides ? record(source.overrides) : {});
      overrides.filters = [
        ...objects(overrides.filters ?? [], "filters").filter(
          (f) => f.field !== field,
        ),
        { field, operator: "eq", value: placement.value! },
      ];
      items.push({
        ...source,
        ...placement,
        id: key,
        width: placement.width ?? source.width!,
        height: placement.height ?? source.height!,
        overrides,
      });
      created.push(key);
    }
  }
  if (new Set(items.map((i) => i.id)).size !== items.length)
    throw new Error("Duplicate dashboard item id");
  const state = clean(
    parseStoredDashboardState({ layout: items, controls: row.controls }, p),
  );
  row.layout = state.items as unknown as ObjectValue[];
  return p === "fanOutDashboardItemsCmd" ? { ok: true, created } : { ok: true };
}
function removeNode(
  graph: Graph,
  table: ArtifactTable,
  id: string,
): ObjectValue[] {
  const row = get(graph, table, id),
    deletedTables = new Set<string>(),
    deletedViz = new Set<string>(),
    orphaned: ObjectValue[] = [];
  if (table === "dataSources")
    for (const item of graph.get("dataTables")!.values())
      if (item.dataSourceId === id) deletedTables.add(item.id);
  if (table === "dataTables") deletedTables.add(id);
  if (table === "visualizations") deletedViz.add(id);
  if (table === "insights")
    for (const item of graph.get("visualizations")!.values())
      if (item.insightId === id) deletedViz.add(item.id);
  for (const insight of graph.get("insights")!.values()) {
    if (table === "insights" && insight.id === id) continue;
    const def = definition(insight),
      source = record(def.source);
    if (
      deletedTables.has(String(source.sourceId)) ||
      (table === "insights" && source.sourceId === id) ||
      objects(def.joins ?? [], "joins").some((j) =>
        deletedTables.has(String(j.rightTableId)),
      )
    )
      orphaned.push({ id: insight.id, kind: "insight" });
  }
  for (const dashboard of graph.get("dashboards")!.values())
    if (
      dashboard.layout?.some((i) => deletedViz.has(String(i.visualizationId)))
    )
      orphaned.push({ id: dashboard.id, kind: "dashboard" });
  const linked = new Set(
    [...deletedTables].flatMap((key) => {
      const tableRow = get(graph, "dataTables", key);
      return tableRow.dataFrameId ? [tableRow.dataFrameId] : [];
    }),
  );
  for (const frame of [...graph.get("dataFrames")!.values()]) {
    const candidate =
      (table === "insights" && frame.insightId === id) ||
      (table === "dataSources" && frame.sourceId === id) ||
      deletedTables.has(String(frame.definitionId)) ||
      linked.has(frame.id);
    if (!candidate) continue;
    if (
      !frame.storage ||
      typeof frame.storage !== "object" ||
      Array.isArray(frame.storage) ||
      frame.storage.type !== "file"
    )
      throw new Error("Legacy browser DataFrames are not supported");
    const outside = [...graph.get("dataTables")!.values()].some(
      (t) => t.dataFrameId === frame.id && !deletedTables.has(t.id),
    );
    if (!outside) graph.get("dataFrames")!.delete(frame.id);
  }
  for (const key of deletedTables) graph.get("dataTables")!.delete(key);
  for (const key of deletedViz) graph.get("visualizations")!.delete(key);
  graph.get(table)!.delete(row.id);
  return orphaned;
}

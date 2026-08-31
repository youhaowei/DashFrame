import { parseStoredDataTableState } from "./tableCodec";
import { storedInsightDefinitionSchema } from "./insightCodec";
import { parseStoredDashboardState } from "./dashboardCodec";
import { stable } from "./values";
import type {
  PreviewDiff,
  PreviewDirectNode,
  PreviewDownstreamNode,
  DownstreamEdge,
  UUID,
} from "@dashframe/types";
import { COMMAND_PATHS } from "@dashframe/types";
import {
  artifactKinds,
  artifactTables,
  type ArtifactRow,
  type ArtifactTable,
} from "./model";
import { cloneGraph, execute, type Graph } from "./engine";
import {
  clean,
  record,
  type Command,
  type Json,
  type ObjectValue,
} from "./values";
export function redact(value: Json): Json {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k, v]) =>
            k !== "apiKey" &&
            k !== "connectionString" &&
            !(typeof v === "string" && v.startsWith("secret:")),
        )
        .map(([k, v]) => [k, redact(v)]),
    );
  return value;
}
export function publicRow(table: ArtifactTable, row: ArtifactRow): ObjectValue {
  if (table === "dataTables")
    parseStoredDataTableState(row, `Data table ${row.id}`);
  if (table === "insights") storedInsightDefinitionSchema.parse(row.definition);
  if (table === "dashboards")
    parseStoredDashboardState(row, `Dashboard ${row.id}`);
  const base = {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (table === "dataSources")
    return clean({
      ...base,
      type: row.kind,
      config: {
        hasApiKey: !!row.config?.apiKey,
        hasConnectionString: !!row.config?.connectionString,
        ...record(redact(row.config ?? {})),
      },
    }) as ObjectValue;
  if (table === "dataTables")
    return clean({
      ...base,
      dataSourceId: row.dataSourceId,
      table: row.table,
      fields: row.fields ?? [],
      metrics: row.metrics ?? [],
      sourceSchema: row.sourceSchema ?? undefined,
      dataFrameId: row.dataFrameId ?? undefined,
      lastFetchedAt: row.lastFetchedAt ?? undefined,
    }) as ObjectValue;
  if (table === "insights")
    return clean({ ...base, ...row.definition }) as ObjectValue;
  if (table === "visualizations")
    return clean({
      ...base,
      insightId: row.insightId,
      visualizationType: row.chartType,
      encoding: row.encoding,
      spec: row.options?.spec ?? {},
    }) as ObjectValue;
  if (table === "dashboards")
    return clean({
      ...base,
      description: row.description ?? undefined,
      items: row.layout ?? [],
      controls: row.controls ?? undefined,
    }) as ObjectValue;
  return clean({
    ...base,
    storage: row.storage,
    fieldIds: row.fieldIds ?? [],
    primaryKey: row.primaryKey ?? undefined,
    insightId: row.insightId ?? undefined,
    sourceId: row.sourceId ?? undefined,
    definitionId: row.definitionId ?? undefined,
    rowCount: row.rowCount ?? undefined,
    columnCount: row.columnCount ?? undefined,
    analysis: row.analysis ?? undefined,
    lastRefreshedAt: row.lastRefreshedAt ?? undefined,
    currentInsightResult:
      row.analysis &&
      typeof row.analysis === "object" &&
      !Array.isArray(row.analysis)
        ? row.analysis.currentInsightResult === true
        : false,
  }) as ObjectValue;
}
export { findLateBound as lateBound } from "./lateBound";
export function signature(revision: number, commands: Command[]) {
  let hash = 2166136261;
  for (const c of stable(commands)) {
    hash ^= c.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${revision}:${(hash >>> 0).toString(16)}:${commands.length}`;
}
function edge(
  from: ArtifactTable,
  id: string,
  to: ArtifactTable,
  row: ArtifactRow,
): DownstreamEdge | null {
  if (from === "dataSources" && to === "dataTables" && row.dataSourceId === id)
    return "dataSource->dataTable";
  if ((from === "dataTables" || from === "insights") && to === "insights") {
    const def = row.definition ?? {},
      source =
        def.source &&
        typeof def.source === "object" &&
        !Array.isArray(def.source)
          ? def.source
          : null;
    if (source?.sourceId === id)
      return from === "insights" ? "insight->insight" : "dataTable->insight";
    if (
      from === "dataTables" &&
      Array.isArray(def.joins) &&
      def.joins.some(
        (j) =>
          j &&
          typeof j === "object" &&
          !Array.isArray(j) &&
          j.rightTableId === id,
      )
    )
      return "dataTable->insight";
  }
  if (from === "insights" && row.insightId === id && to === "dataFrames")
    return "insight->dataFrame";
  if (from === "insights" && row.insightId === id && to === "visualizations")
    return "insight->visualization";
  if (
    from === "visualizations" &&
    to === "dashboards" &&
    row.layout?.some((i) => i.visualizationId === id)
  )
    return "visualization->dashboard";
  if (row.parentArtifactId === id) return "parentArtifact";
  return null;
}
export function preview(
  before: Graph,
  commands: Command[],
  workspaceId: string,
  now: number,
  host = false,
): PreviewDiff {
  const after = cloneGraph(before),
    direct = new Map<string, PreviewDirectNode>();
  let error: PreviewDiff["error"];
  const tables = new Set<string>();
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index]!;
    const prior = cloneGraph(after);
    try {
      const result = execute(after, [command], workspaceId, now, { host })[0]!
        .value;
      const a = record(command.args),
        key = String(a.nodeId ?? a.dashboardId ?? a.id ?? "");
      let target: ArtifactTable | undefined;
      if (
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        (result.target || result.renamed || result.deleted)
      ) {
        const kind = record(
          result.target ?? result.renamed ?? result.deleted,
        ).kind;
        target = artifactTables.find((t) => artifactKinds[t] === kind);
      }
      if (!target)
        target = artifactTables.find(
          (t) => after.get(t)!.has(key) || prior.get(t)!.has(key),
        );
      if (!target) continue;
      const name =
        Object.entries(COMMAND_PATHS).find(
          ([, p]) => p === command.path,
        )?.[0] ?? command.path;
      const mapKey = `${target}:${key}`,
        base = before.get(target)!.get(key),
        value = after.get(target)!.get(key),
        changed = stable(prior.get(target)!.get(key)) !== stable(value);
      if (changed) tables.add(target);
      const existing = direct.get(mapKey);
      direct.set(mapKey, {
        nodeId: key as UUID,
        kind: artifactKinds[target],
        name: base?.name ?? value?.name ?? "Deleted artifact",
        change: !base
          ? "create"
          : changed || existing?.change === "update"
            ? "update"
            : "noop",
        intent: [
          ...(existing?.intent ?? []),
          {
            command: name,
            summary: typeof a.name === "string" ? `${name}: ${a.name}` : name,
          },
        ],
        before: base ? record(redact(publicRow(target, base))) : null,
        proposedDefinition: value
          ? record(redact(publicRow(target, value)))
          : { deleted: true },
      });
    } catch (e) {
      error = {
        commandIndex: index,
        message: e instanceof Error ? e.message : String(e),
      };
      break;
    }
  }
  const downstream: PreviewDownstreamNode[] = [];
  for (const node of direct.values()) {
    if (node.change === "noop") continue;
    const start = artifactTables.find((t) => artifactKinds[t] === node.kind)!;
    const queue: { table: ArtifactTable; id: string }[] = [
      { table: start, id: node.nodeId },
    ];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      for (const table of artifactTables)
        for (const row of before.get(table)!.values()) {
          const e = edge(current.table, current.id, table, row),
            key = `${table}:${row.id}`;
          if (!e || visited.has(key) || direct.has(key)) continue;
          visited.add(key);
          downstream.push({
            nodeId: row.id as UUID,
            kind: artifactKinds[table],
            name: row.name,
            edge: e,
            via: { kind: node.kind, id: node.nodeId },
            flag: node.proposedDefinition.deleted
              ? "orphaned"
              : table === "insights"
                ? "recompute"
                : "stale",
          });
          queue.push({ table, id: row.id });
        }
    }
  }
  return clean({
    mode: "preview",
    directNodes: [...direct.values()],
    affectedDownstream: downstream,
    tablesWritten: [...tables],
    ...(error ? { error } : {}),
  });
}

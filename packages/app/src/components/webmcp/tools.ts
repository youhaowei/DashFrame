import { queryDataFrame } from "@/lib/data-access/data-frames";
import { useInsightCanvasStore } from "@/lib/stores/insight-canvas-store";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import { applyFloor } from "@dashframe/assistant/read/floor";
import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import {
  cmd,
  type Command,
  type ConnectorCatalogEntry,
  type Dashboard,
  type DataSource,
  type DataTable,
  type Insight,
  type InsightFilter,
  type InsightSort,
  type UUID,
  type Visualization,
  type VisualizationEncoding,
  type VisualizationType,
} from "@dashframe/types";
import type { WebMCPToolDefinition } from "./webmcp";
import type { HighlightKind } from "./highlight";

const READ_ONLY = { readOnlyHint: true } as const;
const READ_ONLY_UNTRUSTED = {
  readOnlyHint: true,
  untrustedContentHint: true,
} as const;
const EMPTY_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;
const CHART_TYPES: VisualizationType[] = [
  "barY",
  "barX",
  "line",
  "areaY",
  "dot",
  "hexbin",
  "heatmap",
  "raster",
];

export interface WebMCPToolData {
  connectors?: readonly ConnectorCatalogEntry[];
  dataSources?: readonly DataSource[];
  dataTables?: readonly DataTable[];
  insights?: readonly Insight[];
  visualizations?: readonly Visualization[];
  dashboards?: readonly Dashboard[];
  drafts?: readonly { draftId: string }[];
  route: string;
}

export interface WebMCPToolDependencies {
  read: { getData: () => WebMCPToolData };
  mutations: {
    stageDraft: (
      commands: readonly Command[],
      draftId?: string,
    ) => Promise<{ draftId: string }>;
  };
  ui: {
    navigateToDraft: (draftId: string) => Promise<{ route: string }>;
    highlight: (kind: HighlightKind, id: string) => number;
  };
}

/** Keeps the tool factory's reachable mutation surface explicit and auditable. */
export function defineWebMCPToolDependencies(
  dependencies: WebMCPToolDependencies,
): WebMCPToolDependencies {
  return dependencies;
}

function inputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Tool input must be an object.");
  return input as Record<string, unknown>;
}

function stringValue(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${key} must be a non-empty string.`);
  return value;
}

function optionalStringArray(
  input: Record<string, unknown>,
  key: string,
): string[] {
  const value = input[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${key} must be an array of strings.`);
  return value;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (
    !Number.isInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  return Number(value);
}

function parseFilters(value: unknown): InsightFilter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("filters must be an array of at most 20 filters.");
  const operators = new Set([
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "in",
    "between",
  ]);
  return value.map((candidate) => {
    const filter = inputRecord(candidate);
    if (
      typeof filter.field !== "string" ||
      !operators.has(String(filter.operator)) ||
      !("value" in filter)
    )
      throw new Error("Each filter needs field, operator, and value.");
    return {
      id: typeof filter.id === "string" ? filter.id : crypto.randomUUID(),
      field: filter.field,
      operator: String(filter.operator) as InsightFilter["operator"],
      value: filter.value,
    };
  });
}

function parseSorts(value: unknown): InsightSort[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3)
    throw new Error("sort must be an array of at most 3 sort keys.");
  return value.map((candidate) => {
    const sort = inputRecord(candidate);
    if (
      typeof sort.field !== "string" ||
      (sort.direction !== "asc" && sort.direction !== "desc")
    )
      throw new Error("Each sort needs a field and asc or desc direction.");
    return { field: sort.field, direction: sort.direction };
  });
}

function requireLoaded<T>(
  value: readonly T[] | undefined,
  label: string,
): readonly T[] {
  if (!value) throw new Error(`${label} are still loading. Try again shortly.`);
  return value;
}

function draftResult(
  draftId: string,
  summary: string,
  artifact: Record<string, string>,
) {
  return { draftId, status: "draft" as const, ...artifact, summary };
}

function optionalDraftId(input: Record<string, unknown>): string | undefined {
  return input.draftId === undefined
    ? undefined
    : stringValue(input, "draftId");
}

function fieldReferencesForDataTable(table: DataTable): Set<string> {
  return new Set(
    table.fields.flatMap((field) => [
      field.id,
      field.name,
      field.columnName ?? field.name,
      fieldIdToColumnAlias(field.id),
    ]),
  );
}

function fieldReferencesForInsight(
  insight: Insight,
  tables: readonly DataTable[],
): Set<string> {
  const references = new Set<string>();
  for (const fieldId of insight.selectedFields) {
    references.add(fieldId);
    references.add(fieldIdToColumnAlias(fieldId));
    for (const table of tables) {
      const field = table.fields.find((candidate) => candidate.id === fieldId);
      if (field) {
        references.add(field.name);
        references.add(field.columnName ?? field.name);
      }
    }
  }
  for (const metric of insight.metrics) {
    references.add(metric.id);
    references.add(metric.name);
    references.add(metricIdToColumnAlias(metric.id));
  }
  return references;
}

function assertInsightFields(
  selectedFieldIds: readonly string[],
  filters: readonly InsightFilter[],
  sorts: readonly InsightSort[],
  references: ReadonlySet<string>,
): void {
  if (selectedFieldIds.some((field) => !references.has(field)))
    throw new Error("selectedFieldIds contains a field outside this source.");
  if (filters.some((filter) => !references.has(filter.field)))
    throw new Error("filters contains a field outside this source.");
  if (sorts.some((sort) => !references.has(sort.field)))
    throw new Error("sort contains a field outside this source.");
}

function pageContext(data: WebMCPToolData) {
  const live = useWebMCPPageStore.getState();
  const insightMatch = data.route.match(/^\/insights\/([^/]+)/);
  const dashboardMatch = data.route.match(/^\/dashboards\/([^/]+)/);
  const insight = insightMatch
    ? requireLoaded(data.insights, "Insights").find(
        (candidate) => candidate.id === insightMatch[1],
      )
    : undefined;
  const dashboard = dashboardMatch
    ? requireLoaded(data.dashboards, "Dashboards").find(
        (candidate) => candidate.id === dashboardMatch[1],
      )
    : undefined;
  return {
    route: data.route,
    openInsight: insight
      ? {
          id: insight.id,
          name: insight.name,
          source: insight.source,
          selectedFieldIds: insight.selectedFields,
          filters: insight.filters ?? [],
          sorts: insight.sorts ?? [],
          activeView: useInsightCanvasStore.getState().activeViewByInsight[
            insight.id
          ] ?? {
            kind: "table",
          },
          unsaved: {
            pendingName:
              live.insight?.insightId === insight.id
                ? live.insight.pendingName
                : undefined,
            filters: [],
            sorts: [],
          },
        }
      : null,
    openDashboard: dashboard
      ? {
          id: dashboard.id,
          name: dashboard.name,
          itemCount: dashboard.items.length,
          items: dashboard.items.map((item) => ({
            id: item.id,
            type: item.type,
            ...(item.visualizationId
              ? { visualizationId: item.visualizationId }
              : {}),
          })),
          savedControls: dashboard.controls ?? [],
          unsavedControlValues:
            live.dashboard?.dashboardId === dashboard.id
              ? live.dashboard.transientControlValues
              : {},
        }
      : null,
  };
}

export function createWebMCPTools(
  dependencies: WebMCPToolDependencies,
): WebMCPToolDefinition[] {
  const mutationNames = Object.keys(dependencies.mutations);
  if (mutationNames.length !== 1 || mutationNames[0] !== "stageDraft")
    throw new Error("WebMCP tools may reach only the draft staging mutation.");
  return [
    {
      name: "list_connectors",
      title: "List connectors",
      description:
        "List the connector types this DashFrame app can use, including their authentication and input requirements.",
      inputSchema: EMPTY_SCHEMA,
      annotations: READ_ONLY,
      execute: async () => ({
        connectors: requireLoaded(
          dependencies.read.getData().connectors,
          "Connectors",
        ).map(({ id, name, description, sourceType, authKind, accept }) => ({
          id,
          name,
          description,
          sourceType,
          authKind,
          ...(accept ? { accept } : {}),
        })),
      }),
    },
    {
      name: "list_data_sources",
      title: "List data sources",
      description:
        "List data sources and their tables in the current DashFrame project.",
      inputSchema: EMPTY_SCHEMA,
      annotations: READ_ONLY_UNTRUSTED,
      execute: async () => {
        const data = dependencies.read.getData();
        const sources = requireLoaded(data.dataSources, "Data sources");
        const tables = requireLoaded(data.dataTables, "Data tables");
        return {
          dataSources: sources.map((source) => ({
            id: source.id,
            name: source.name,
            connectorType: source.type,
            tables: tables
              .filter((table) => table.dataSourceId === source.id)
              .map((table) => ({
                id: table.id,
                name: table.name,
                sourceTable: table.table,
                loaded: Boolean(table.dataFrameId),
              })),
          })),
        };
      },
    },
    {
      name: "describe_table",
      title: "Describe table",
      description:
        "Describe one DashFrame table's columns and return up to three sample values per column.",
      inputSchema: {
        type: "object",
        properties: {
          tableId: { type: "string", description: "Data table id." },
        },
        required: ["tableId"],
        additionalProperties: false,
      },
      annotations: READ_ONLY_UNTRUSTED,
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
        const tableId = stringValue(input, "tableId");
        const table = requireLoaded(
          dependencies.read.getData().dataTables,
          "Data tables",
        ).find((candidate) => candidate.id === tableId);
        if (!table) throw new Error("Data table not found.");
        const page = table.dataFrameId
          ? await queryDataFrame(table.dataFrameId, { limit: 5 })
          : null;
        if (page?.status === "failed") throw new Error(page.message);
        const rawRows = (page?.rows ?? []).map((row) =>
          Object.fromEntries(
            table.fields.map((field) => [
              field.name,
              row[field.id] ?? row[field.columnName ?? field.name] ?? null,
            ]),
          ),
        );
        const gated = applyFloor(
          { kind: "dataTable", id: table.id },
          table.fields,
          { sampleRows: rawRows, maxRows: 3 },
        );
        return {
          table: { id: table.id, name: table.name, sourceTable: table.table },
          columns: table.fields.map((field) => {
            const profile = gated.columns.find(
              (column) => column.name === field.name,
            );
            return {
              id: field.id,
              name: field.name,
              sourceName: field.columnName ?? field.name,
              type: field.type,
              sensitivity: profile?.sensitivity ?? "unclassified",
              sampleValues: [
                ...new Set(
                  (gated.sample?.rows ?? []).map((row) => row[field.name]),
                ),
              ].filter((value) => value !== undefined),
            };
          }),
          masked: gated.masked,
          valueTier: gated.sample?.tier,
          rowCount: page?.totalCount ?? null,
        };
      },
    },
    {
      name: "query_data",
      title: "Query data",
      description:
        "Read a bounded page from one loaded DashFrame table. Optionally project fields and sort; this cannot run SQL or mutate data.",
      inputSchema: {
        type: "object",
        properties: {
          tableId: { type: "string" },
          fieldIds: { type: "array", items: { type: "string" }, maxItems: 50 },
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          sort: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                fieldId: { type: "string" },
                direction: { type: "string", enum: ["asc", "desc"] },
              },
              required: ["fieldId", "direction"],
              additionalProperties: false,
            },
          },
        },
        required: ["tableId"],
        additionalProperties: false,
      },
      annotations: READ_ONLY_UNTRUSTED,
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
        const tableId = stringValue(input, "tableId");
        const table = requireLoaded(
          dependencies.read.getData().dataTables,
          "Data tables",
        ).find((candidate) => candidate.id === tableId);
        if (!table) throw new Error("Data table not found.");
        if (!table.dataFrameId)
          throw new Error("Data table has no loaded data.");
        const fieldIds = optionalStringArray(input, "fieldIds");
        const knownFieldIds = new Set(table.fields.map((field) => field.id));
        if (fieldIds.some((id) => !knownFieldIds.has(id as UUID)))
          throw new Error("fieldIds contains a field outside this table.");
        const sortInput = input.sort;
        if (
          sortInput !== undefined &&
          (!Array.isArray(sortInput) || sortInput.length > 3)
        )
          throw new Error("sort must contain at most 3 keys.");
        const sort = (
          sortInput as Array<Record<string, unknown>> | undefined
        )?.map((candidate) => {
          const item = inputRecord(candidate);
          const fieldId = stringValue(item, "fieldId");
          if (!knownFieldIds.has(fieldId as UUID))
            throw new Error("sort contains a field outside this table.");
          if (item.direction !== "asc" && item.direction !== "desc")
            throw new Error("sort direction must be asc or desc.");
          return {
            fieldId: fieldId as UUID,
            direction: item.direction as "asc" | "desc",
          };
        });
        const page = await queryDataFrame(table.dataFrameId, {
          offset: boundedInteger(input.offset, 0, 0, 1_000_000, "offset"),
          limit: boundedInteger(input.limit, 50, 1, 100, "limit"),
          sort,
        });
        if (page.status === "failed") throw new Error(page.message);
        const selected = fieldIds.length ? new Set(fieldIds) : null;
        const selectedFields = selected
          ? table.fields.filter((field) => selected.has(field.id))
          : table.fields;
        const rawRows = page.rows.map((row) =>
          Object.fromEntries(
            selectedFields.map((field) => [
              field.name,
              row[field.id] ?? row[field.columnName ?? field.name] ?? null,
            ]),
          ),
        );
        const gated = applyFloor(
          { kind: "dataTable", id: table.id },
          selectedFields,
          { sampleRows: rawRows, maxRows: page.rows.length },
        );
        return {
          table: { id: table.id, name: table.name },
          schema: selectedFields.map((field) => ({
            id: field.id,
            name: field.name,
            type: field.type,
            sensitivity: field.sensitivity ?? "unclassified",
          })),
          rows: gated.sample?.rows ?? [],
          masked: gated.masked,
          valueTier: gated.sample?.tier,
          truncated: gated.sample?.truncated ?? false,
          totalCount: page.totalCount,
          page: page.page,
        };
      },
    },
    {
      name: "propose_insight",
      title: "Propose insight",
      description:
        "Stage a new Insight as a draft for human review. Never changes the published project.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          sourceType: { type: "string", enum: ["dataTable", "insight"] },
          sourceId: { type: "string" },
          selectedFieldIds: {
            type: "array",
            items: { type: "string" },
            maxItems: 100,
          },
          filters: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                operator: {
                  type: "string",
                  enum: [
                    "eq",
                    "ne",
                    "gt",
                    "gte",
                    "lt",
                    "lte",
                    "contains",
                    "in",
                    "between",
                  ],
                },
                value: {},
              },
              required: ["field", "operator", "value"],
              additionalProperties: false,
            },
          },
          sort: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                direction: { type: "string", enum: ["asc", "desc"] },
              },
              required: ["field", "direction"],
              additionalProperties: false,
            },
          },
          draftId: {
            type: "string",
            description: "Existing draft id to append this proposal to.",
          },
        },
        required: ["name", "sourceType", "sourceId", "selectedFieldIds"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
        const name = stringValue(input, "name");
        const sourceId = stringValue(input, "sourceId") as UUID;
        if (input.sourceType !== "dataTable" && input.sourceType !== "insight")
          throw new Error("sourceType must be dataTable or insight.");
        const draftId = optionalDraftId(input);
        const data = dependencies.read.getData();
        const tables =
          input.sourceType === "dataTable"
            ? requireLoaded(data.dataTables, "Data tables")
            : (data.dataTables ?? []);
        const source =
          input.sourceType === "dataTable"
            ? tables.find((table) => table.id === sourceId)
            : requireLoaded(data.insights, "Insights").find(
                (insight) => insight.id === sourceId,
              );
        if (!source) throw new Error("Insight source not found.");
        const selectedFieldIds = optionalStringArray(
          input,
          "selectedFieldIds",
        ) as UUID[];
        const filters = parseFilters(input.filters);
        const sorts = parseSorts(input.sort);
        const selectableIds = new Set(
          input.sourceType === "dataTable"
            ? (source as DataTable).fields.map((field) => field.id)
            : [
                ...(source as Insight).selectedFields,
                ...(source as Insight).metrics.map((metric) => metric.id),
              ],
        );
        if (selectedFieldIds.some((field) => !selectableIds.has(field)))
          throw new Error(
            "selectedFieldIds contains a field outside this source.",
          );
        const references =
          input.sourceType === "dataTable"
            ? fieldReferencesForDataTable(source as DataTable)
            : fieldReferencesForInsight(source as Insight, tables);
        assertInsightFields([], filters, sorts, references);
        const id = crypto.randomUUID() as UUID;
        const commands: Command[] = [
          cmd("CreateInsight", {
            id,
            name,
            source: { sourceType: input.sourceType, sourceId },
            selectedFields: selectedFieldIds,
            metrics: [],
          }),
        ];
        if (filters.length)
          commands.push(cmd("SetInsightFilter", { id, filters }));
        if (sorts.length) commands.push(cmd("SetInsightSort", { id, sorts }));
        const result = await dependencies.mutations.stageDraft(
          commands,
          draftId,
        );
        return draftResult(
          result.draftId,
          `Create “${name}” from ${input.sourceType} ${sourceId} with ${selectedFieldIds.length} fields, ${filters.length} filters, and ${sorts.length} sort keys.`,
          { insightId: id },
        );
      },
    },
    {
      name: "propose_chart",
      title: "Propose chart",
      description:
        "Stage a visualization on an existing Insight as a draft for human review.",
      inputSchema: {
        type: "object",
        properties: {
          insightId: { type: "string" },
          name: { type: "string", minLength: 1, maxLength: 120 },
          chartType: { type: "string", enum: CHART_TYPES },
          encoding: { type: "object" },
          draftId: {
            type: "string",
            description: "Existing draft id to append this proposal to.",
          },
        },
        required: ["insightId", "name", "chartType", "encoding"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
        const draftId = optionalDraftId(input);
        const insightId = stringValue(input, "insightId") as UUID;
        const name = stringValue(input, "name");
        if (!CHART_TYPES.includes(input.chartType as VisualizationType))
          throw new Error("Unsupported chartType.");
        if (
          !input.encoding ||
          typeof input.encoding !== "object" ||
          Array.isArray(input.encoding)
        )
          throw new Error("encoding must be an object.");
        const insights = requireLoaded(
          dependencies.read.getData().insights,
          "Insights",
        );
        if (!draftId && !insights.some((item) => item.id === insightId))
          throw new Error("Insight not found.");
        const id = crypto.randomUUID() as UUID;
        const result = await dependencies.mutations.stageDraft(
          [
            cmd("CreateVisualization", {
              id,
              name,
              insightId,
              visualizationType: input.chartType as VisualizationType,
              encoding: input.encoding as VisualizationEncoding,
              spec: {},
            }),
          ],
          draftId,
        );
        return draftResult(
          result.draftId,
          `Create a ${input.chartType} chart named “${name}” on Insight ${insightId}.`,
          { visualizationId: id },
        );
      },
    },
    {
      name: "add_to_dashboard",
      title: "Add to dashboard",
      description:
        "Stage adding an existing visualization to a dashboard as a draft for human review.",
      annotations: { untrustedContentHint: true },
      inputSchema: {
        type: "object",
        properties: {
          dashboardId: { type: "string" },
          visualizationId: { type: "string" },
          width: { type: "integer", minimum: 2, maximum: 12, default: 6 },
          height: { type: "integer", minimum: 2, maximum: 12, default: 6 },
          draftId: {
            type: "string",
            description: "Existing draft id to append this proposal to.",
          },
        },
        required: ["dashboardId", "visualizationId"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
        const draftId = optionalDraftId(input);
        const dashboardId = stringValue(input, "dashboardId") as UUID;
        const visualizationId = stringValue(input, "visualizationId") as UUID;
        const data = dependencies.read.getData();
        const dashboard = requireLoaded(data.dashboards, "Dashboards").find(
          (item) => item.id === dashboardId,
        );
        if (!dashboard) throw new Error("Dashboard not found.");
        const visualizations = requireLoaded(
          data.visualizations,
          "Visualizations",
        );
        if (
          !draftId &&
          !visualizations.some((item) => item.id === visualizationId)
        )
          throw new Error("Visualization not found.");
        const y = dashboard.items.reduce(
          (bottom, item) => Math.max(bottom, item.y + item.height),
          0,
        );
        const itemId = crypto.randomUUID() as UUID;
        const result = await dependencies.mutations.stageDraft(
          [
            cmd("AddDashboardItem", {
              dashboardId,
              item: {
                id: itemId,
                type: "visualization",
                visualizationId,
                x: 0,
                y,
                width: boundedInteger(input.width, 6, 2, 12, "width"),
                height: boundedInteger(input.height, 6, 2, 12, "height"),
              },
            }),
          ],
          draftId,
        );
        return draftResult(
          result.draftId,
          `Add visualization ${visualizationId} to “${dashboard.name}” as widget ${itemId}.`,
          { dashboardId, visualizationId, widgetId: itemId },
        );
      },
    },
    {
      name: "whats_on_screen",
      title: "What's on screen",
      description:
        "Read the current route, open Insight or dashboard, and live unsaved filters, sorts, controls, and view selection.",
      inputSchema: EMPTY_SCHEMA,
      annotations: READ_ONLY_UNTRUSTED,
      execute: async () => pageContext(dependencies.read.getData()),
    },
    {
      name: "show_draft",
      title: "Show draft",
      description:
        "Navigate DashFrame to a draft's review screen so the human can inspect its preview diff. Does not publish it.",
      inputSchema: {
        type: "object",
        properties: { draftId: { type: "string" } },
        required: ["draftId"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const draftId = stringValue(inputRecord(rawInput), "draftId");
        const drafts = requireLoaded(
          dependencies.read.getData().drafts,
          "Drafts",
        );
        if (!drafts.some((draft) => draft.draftId === draftId))
          throw new Error(
            "Draft not found. It may have been published or discarded.",
          );
        const { route } = await dependencies.ui.navigateToDraft(draftId);
        return {
          draftId,
          route,
          summary: "Draft review is now open.",
        };
      },
    },
    {
      name: "highlight_widget",
      title: "Highlight widget",
      description:
        "Temporarily highlight a visible dashboard widget or the open Insight while explaining it.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["widget", "insight"] },
          id: { type: "string" },
        },
        required: ["kind", "id"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
        if (input.kind !== "widget" && input.kind !== "insight")
          throw new Error("kind must be widget or insight.");
        const id = stringValue(input, "id");
        const durationMs = dependencies.ui.highlight(input.kind, id);
        return {
          kind: input.kind,
          id,
          durationMs,
          summary: "The item is highlighted on screen.",
        };
      },
    },
  ];
}

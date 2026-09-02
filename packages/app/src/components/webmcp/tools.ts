import { queryDataFrame } from "@/lib/data-access/data-frames";
import { useInsightCanvasStore } from "@/lib/stores/insight-canvas-store";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
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

const READ_ONLY = { readOnlyHint: true } as const;
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
  route: string;
}

export interface WebMCPToolDependencies {
  getData: () => WebMCPToolData;
  stageDraft: (commands: readonly Command[]) => Promise<{ draftId: string }>;
  navigateToDraft: (draftId: string) => Promise<void> | void;
  document: Document;
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

function draftResult(draftId: string, summary: string) {
  return { draftId, status: "draft" as const, summary };
}

function clearHighlights(doc: Document): void {
  for (const element of doc.querySelectorAll("[data-webmcp-highlight]"))
    element.removeAttribute("data-webmcp-highlight");
}

function findHighlightTarget(
  doc: Document,
  kind: "widget" | "insight",
  id: string,
): HTMLElement | null {
  const attribute =
    kind === "widget"
      ? "data-dashframe-widget-id"
      : "data-dashframe-insight-id";
  return (
    Array.from(doc.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
      (element) => element.getAttribute(attribute) === id,
    ) ?? null
  );
}

function pageContext(data: WebMCPToolData) {
  const live = useWebMCPPageStore.getState();
  const insightMatch = data.route.match(/^\/insights\/([^/]+)/);
  const dashboardMatch = data.route.match(/^\/dashboards\/([^/]+)/);
  const insight = insightMatch
    ? data.insights?.find((candidate) => candidate.id === insightMatch[1])
    : undefined;
  const dashboard = dashboardMatch
    ? data.dashboards?.find((candidate) => candidate.id === dashboardMatch[1])
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
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
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
          dependencies.getData().connectors,
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
      annotations: READ_ONLY,
      execute: async () => {
        const data = dependencies.getData();
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
      annotations: READ_ONLY,
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
        const tableId = stringValue(input, "tableId");
        const table = requireLoaded(
          dependencies.getData().dataTables,
          "Data tables",
        ).find((candidate) => candidate.id === tableId);
        if (!table) throw new Error("Data table not found.");
        const page = table.dataFrameId
          ? await queryDataFrame(table.dataFrameId, { limit: 5 })
          : null;
        if (page?.status === "failed") throw new Error(page.message);
        const rows = page?.rows ?? [];
        return {
          table: { id: table.id, name: table.name, sourceTable: table.table },
          columns: table.fields.map((field) => ({
            id: field.id,
            name: field.name,
            sourceName: field.columnName ?? field.name,
            type: field.type,
            sampleValues: [
              ...new Set(
                rows.map(
                  (row) => row[field.id] ?? row[field.columnName ?? field.name],
                ),
              ),
            ]
              .filter((value) => value !== undefined)
              .slice(0, 3),
          })),
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
      annotations: READ_ONLY,
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
        const tableId = stringValue(input, "tableId");
        const table = requireLoaded(
          dependencies.getData().dataTables,
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
        const schema = selected
          ? page.schema.filter((column) => selected.has(column.id))
          : page.schema;
        return {
          table: { id: table.id, name: table.name },
          schema,
          rows: page.rows.map((row) =>
            Object.fromEntries(
              schema.map((column) => [
                column.name,
                row[column.id] ?? row[column.name] ?? null,
              ]),
            ),
          ),
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
        const data = dependencies.getData();
        const sourceExists =
          input.sourceType === "dataTable"
            ? data.dataTables?.some((table) => table.id === sourceId)
            : data.insights?.some((insight) => insight.id === sourceId);
        if (!sourceExists) throw new Error("Insight source not found.");
        const selectedFieldIds = optionalStringArray(
          input,
          "selectedFieldIds",
        ) as UUID[];
        const filters = parseFilters(input.filters);
        const sorts = parseSorts(input.sort);
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
        const result = await dependencies.stageDraft(commands);
        return draftResult(
          result.draftId,
          `Create “${name}” from ${input.sourceType} ${sourceId} with ${selectedFieldIds.length} fields, ${filters.length} filters, and ${sorts.length} sort keys.`,
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
        },
        required: ["insightId", "name", "chartType", "encoding"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
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
        if (
          !dependencies
            .getData()
            .insights?.some((item) => item.id === insightId)
        )
          throw new Error("Insight not found.");
        const id = crypto.randomUUID() as UUID;
        const result = await dependencies.stageDraft([
          cmd("CreateVisualization", {
            id,
            name,
            insightId,
            visualizationType: input.chartType as VisualizationType,
            encoding: input.encoding as VisualizationEncoding,
            spec: {},
          }),
        ]);
        return draftResult(
          result.draftId,
          `Create a ${input.chartType} chart named “${name}” on Insight ${insightId}.`,
        );
      },
    },
    {
      name: "add_to_dashboard",
      title: "Add to dashboard",
      description:
        "Stage adding an existing visualization to a dashboard as a draft for human review.",
      inputSchema: {
        type: "object",
        properties: {
          dashboardId: { type: "string" },
          visualizationId: { type: "string" },
          width: { type: "integer", minimum: 2, maximum: 12, default: 6 },
          height: { type: "integer", minimum: 2, maximum: 12, default: 6 },
        },
        required: ["dashboardId", "visualizationId"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const input = inputRecord(rawInput);
        const dashboardId = stringValue(input, "dashboardId") as UUID;
        const visualizationId = stringValue(input, "visualizationId") as UUID;
        const data = dependencies.getData();
        const dashboard = data.dashboards?.find(
          (item) => item.id === dashboardId,
        );
        if (!dashboard) throw new Error("Dashboard not found.");
        if (!data.visualizations?.some((item) => item.id === visualizationId))
          throw new Error("Visualization not found.");
        const y = dashboard.items.reduce(
          (bottom, item) => Math.max(bottom, item.y + item.height),
          0,
        );
        const itemId = crypto.randomUUID() as UUID;
        const result = await dependencies.stageDraft([
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
        ]);
        return draftResult(
          result.draftId,
          `Add visualization ${visualizationId} to “${dashboard.name}” as widget ${itemId}.`,
        );
      },
    },
    {
      name: "whats_on_screen",
      title: "What's on screen",
      description:
        "Read the current route, open Insight or dashboard, and live unsaved filters, sorts, controls, and view selection.",
      inputSchema: EMPTY_SCHEMA,
      annotations: READ_ONLY,
      execute: async () => pageContext(dependencies.getData()),
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
        await dependencies.navigateToDraft(draftId);
        return {
          draftId,
          route: `/drafts/${draftId}/`,
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
        const target = findHighlightTarget(
          dependencies.document,
          input.kind,
          id,
        );
        if (!target)
          throw new Error("The requested item is not visible on screen.");
        if (highlightTimer) clearTimeout(highlightTimer);
        clearHighlights(dependencies.document);
        target.setAttribute("data-webmcp-highlight", "true");
        const reduceMotion =
          typeof globalThis.matchMedia === "function" &&
          globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "center",
        });
        highlightTimer = setTimeout(() => {
          target.removeAttribute("data-webmcp-highlight");
          highlightTimer = undefined;
        }, 4_000);
        return {
          kind: input.kind,
          id,
          durationMs: 4_000,
          summary: "The item is highlighted on screen.",
        };
      },
    },
  ];
}

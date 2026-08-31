import {
  COMMAND_GUIDE,
  createReadTools,
  CREDENTIAL_COMMAND_ARG_FIELDS,
  defineToolHandler,
  DRAFT_SAFE_COMMANDS,
  Type,
  validateToolArgs,
  type GraphReader,
  type TSchema,
} from "@dashframe/assistant";
import {
  cmd,
  COMMAND_PATHS,
  type Command,
  type CommandName,
  type CommandPayloads,
} from "@dashframe/types";
import { isSecretRef } from "@wystack/secret-vault";
import type { ApplicationOperations } from "../host/application";

import { createAssistantReadHost } from "../assistant-read-host";
import { isPrincipal } from "@wystack/identity";
const DRAFT_UNAVAILABLE = "Draft unavailable";
import { assertKnownCommandPaths } from "../host/commands";
import { REPORT_APP_URI } from "./report-app";
import type { McpMode, McpRequestContext } from "./route";

type AssistantTool = {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (
    toolCallId: string,
    params: never,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: unknown;
  }>;
};

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: TSchema;
  outputSchema?: TSchema;
  annotations?: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
  _meta?: Record<string, unknown>;
  execute(args: unknown): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  }>;
}

/** The write tool's name — snake_case, matching the read tools. */
export const DRAFT_BATCH_TOOL_NAME = "draft_batch";

const DATA_QUERY_MAX_LIMIT = 500;
const REPORT_PREVIEW_LIMIT = 50;
const REPORT_INITIAL_PAGE_LIMIT = 10;
const REPORT_SCHEMA_LIMIT = 100;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const CLOSED_SCHEMA = { additionalProperties: false } as const;
const ARTIFACT_KINDS = [
  "dataSource",
  "dataTable",
  "dataFrame",
  "insight",
  "visualization",
  "dashboard",
] as const;

const artifactKindSchema = Type.Union(
  ARTIFACT_KINDS.map((kind) => Type.Literal(kind)),
);
const nodeRefSchema = Type.Object(
  {
    kind: artifactKindSchema,
    id: Type.String({ format: "uuid" }),
  },
  CLOSED_SCHEMA,
);
const nodeSummarySchema = Type.Object(
  {
    ref: nodeRefSchema,
    name: Type.String(),
  },
  CLOSED_SCHEMA,
);
const frameFieldSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    type: Type.String(),
  },
  CLOSED_SCHEMA,
);
const frameMetadataSchema = Type.Object(
  {
    dataFrameId: Type.String({ format: "uuid" }),
    schema: Type.Array(frameFieldSchema),
    rowCount: Type.Integer({ minimum: 0 }),
    provenance: Type.Object(
      {
        connectorKind: Type.String(),
        bindingVersion: Type.String(),
      },
      CLOSED_SCHEMA,
    ),
    fetchedAt: Type.Number(),
  },
  CLOSED_SCHEMA,
);
const readyMaterializationSchema = Type.Object(
  {
    status: Type.Literal("ready"),
    ...frameMetadataSchema.properties,
  },
  CLOSED_SCHEMA,
);
const failedMaterializationSchema = Type.Object(
  {
    status: Type.Literal("failed"),
    code: Type.String(),
    message: Type.String(),
    retryable: Type.Boolean(),
    lastSuccessful: Type.Optional(
      Type.Object(
        {
          stale: Type.Literal(true),
          ...frameMetadataSchema.properties,
        },
        CLOSED_SCHEMA,
      ),
    ),
  },
  CLOSED_SCHEMA,
);
const materializationOutputSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("ready"), Type.Literal("failed")]),
    dataFrameId: Type.Optional(Type.String({ format: "uuid" })),
    schema: Type.Optional(Type.Array(frameFieldSchema)),
    rowCount: Type.Optional(Type.Integer({ minimum: 0 })),
    provenance: Type.Optional(
      Type.Object(
        {
          connectorKind: Type.String(),
          bindingVersion: Type.String(),
        },
        CLOSED_SCHEMA,
      ),
    ),
    fetchedAt: Type.Optional(Type.Number()),
    code: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    retryable: Type.Optional(Type.Boolean()),
    lastSuccessful: Type.Optional(
      Type.Object(
        {
          stale: Type.Literal(true),
          ...frameMetadataSchema.properties,
        },
        CLOSED_SCHEMA,
      ),
    ),
  },
  {
    ...CLOSED_SCHEMA,
    oneOf: [readyMaterializationSchema, failedMaterializationSchema],
  },
);

function publicMaterializationResult(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (value.status === "ready") {
    return {
      status: "ready",
      dataFrameId: value.dataFrameId,
      schema: value.schema,
      rowCount: value.rowCount,
      provenance: value.provenance,
      fetchedAt: value.fetchedAt,
    };
  }
  return {
    status: "failed",
    code: value.code,
    message: value.message,
    retryable: value.retryable,
    ...(typeof value.lastSuccessful === "object" &&
    value.lastSuccessful !== null
      ? {
          lastSuccessful: publicStaleFrame(
            value.lastSuccessful as Record<string, unknown>,
          ),
        }
      : {}),
  };
}

function publicStaleFrame(value: Record<string, unknown>) {
  return {
    stale: true,
    dataFrameId: value.dataFrameId,
    schema: value.schema,
    rowCount: value.rowCount,
    provenance: value.provenance,
    fetchedAt: value.fetchedAt,
  };
}

const readToolOutputSchemas: Readonly<Record<string, TSchema>> = {
  read_neighborhood: Type.Object(
    {
      neighborhood: Type.Optional(
        Type.Object(
          {
            center: nodeSummarySchema,
            downstream: Type.Array(nodeSummarySchema),
            upstream: Type.Array(nodeSummarySchema),
          },
          CLOSED_SCHEMA,
        ),
      ),
      error: Type.Optional(Type.String()),
    },
    CLOSED_SCHEMA,
  ),
  read_graph: Type.Object(
    {
      reached: Type.Array(
        Type.Object(
          {
            ...nodeSummarySchema.properties,
            depth: Type.Integer({ minimum: 0, maximum: 6 }),
          },
          CLOSED_SCHEMA,
        ),
      ),
    },
    CLOSED_SCHEMA,
  ),
  find_nodes: Type.Object(
    { hits: Type.Array(nodeSummarySchema) },
    CLOSED_SCHEMA,
  ),
  read_artifact: Type.Object(
    {
      kind: Type.Optional(artifactKindSchema),
      definition: Type.Optional(Type.Any()),
      error: Type.Optional(Type.String()),
    },
    CLOSED_SCHEMA,
  ),
  read_data: Type.Object(
    {
      node: Type.Optional(nodeRefSchema),
      masked: Type.Optional(Type.Boolean()),
      resolution: Type.Optional(
        Type.Union([Type.Literal("complete"), Type.Literal("unresolved")]),
      ),
      unresolvedReason: Type.Optional(Type.String()),
      columns: Type.Optional(
        Type.Array(
          Type.Object(
            {
              name: Type.String(),
              type: Type.String(),
              sensitivity: Type.Union([
                Type.Literal("unclassified"),
                Type.Literal("sensitive"),
                Type.Literal("cleared"),
              ]),
              stats: Type.Optional(
                Type.Object(
                  {
                    rowCount: Type.Optional(Type.Integer({ minimum: 0 })),
                    nullCount: Type.Optional(Type.Integer({ minimum: 0 })),
                    distinctCount: Type.Optional(Type.Integer({ minimum: 0 })),
                  },
                  CLOSED_SCHEMA,
                ),
              ),
            },
            CLOSED_SCHEMA,
          ),
        ),
      ),
      sample: Type.Optional(
        Type.Object(
          {
            tier: Type.Union([
              Type.Literal("raw"),
              Type.Literal("mixed"),
              Type.Literal("obfuscated"),
            ]),
            rows: Type.Array(Type.Record(Type.String(), Type.Any())),
            rowCount: Type.Integer({ minimum: 0 }),
            truncated: Type.Boolean(),
          },
          CLOSED_SCHEMA,
        ),
      ),
      error: Type.Optional(Type.String()),
    },
    CLOSED_SCHEMA,
  ),
  read_source: Type.Object(
    {
      file: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
      error: Type.Optional(Type.String()),
    },
    CLOSED_SCHEMA,
  ),
};

const draftBatchOutputSchema = Type.Object(
  {
    draftId: Type.String({ format: "uuid" }),
    commandCount: Type.Integer({ minimum: 1 }),
  },
  CLOSED_SCHEMA,
);

function outputSchemaForAssistantTool(
  name: string,
  isReadTool: boolean,
): TSchema {
  if (!isReadTool) return draftBatchOutputSchema;
  const schema = readToolOutputSchemas[name];
  if (schema === undefined) {
    throw new Error(`Missing MCP output schema for read tool "${name}".`);
  }
  return schema;
}

function dataTool(
  app: ApplicationOperations,
  context: McpRequestContext,
  name: string,
  description: string,
  inputSchema: TSchema,
  outputSchema: TSchema,
  path: "fetchData" | "runInsight" | "queryDataFrame",
): McpTool {
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    annotations:
      path === "queryDataFrame"
        ? READ_ONLY_ANNOTATIONS
        : {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
    ...(path === "queryDataFrame"
      ? {
          _meta: {
            ui: { visibility: ["model", "app"] },
            "openai/widgetAccessible": true,
          },
        }
      : {}),
    async execute(args) {
      const checked = validateToolArgs(inputSchema, args);
      if (!checked.ok) throw new Error(checked.error.message);
      const response = await app.execute(path, checked.value, {
        principal: context.principal,
      });
      const rawResult = response as Record<string, unknown>;
      const result =
        path === "queryDataFrame"
          ? rawResult
          : publicMaterializationResult(rawResult);
      const failed = result.status === "failed";
      return {
        content: [
          {
            type: "text",
            text: failed
              ? "The requested data operation failed."
              : `${name} completed.`,
          },
        ],
        ...(failed ? { isError: true } : {}),
        structuredContent: result,
      };
    },
  };
}

function frameFailure(page: Record<string, unknown>) {
  const failed = {
    status: "failed" as const,
    code: typeof page.code === "string" ? page.code : "FRAME_UNAVAILABLE",
    message:
      typeof page.message === "string"
        ? page.message
        : "The requested DataFrame is unavailable.",
  };
  return {
    content: [{ type: "text" as const, text: failed.message }],
    isError: true,
    structuredContent: failed,
  };
}

function frameEntry(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type FrameField = { id: string; name: string; type: string };
type ReadyFramePage = {
  schema: FrameField[];
  rows: Array<Record<string, unknown>>;
  totalCount: number;
  page: { offset: number; limit: number; returned: number };
};

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isFrameField(value: unknown): value is FrameField {
  const field = frameEntry(value);
  return (
    field !== null &&
    typeof field.id === "string" &&
    typeof field.name === "string" &&
    typeof field.type === "string"
  );
}

function readyFramePage(value: unknown): ReadyFramePage | null {
  const result = frameEntry(value);
  const page = frameEntry(result?.page);
  if (
    result?.status !== "ready" ||
    !Array.isArray(result.schema) ||
    !result.schema.every(isFrameField) ||
    !Array.isArray(result.rows) ||
    result.rows.length > REPORT_PREVIEW_LIMIT ||
    !isNonNegativeInteger(result.totalCount) ||
    page === null ||
    !isNonNegativeInteger(page.offset) ||
    !isNonNegativeInteger(page.limit) ||
    page.limit < 1 ||
    page.limit > REPORT_PREVIEW_LIMIT ||
    !isNonNegativeInteger(page.returned) ||
    page.returned > page.limit ||
    page.returned !== result.rows.length
  ) {
    return null;
  }
  const rows = result.rows.map(frameEntry);
  if (rows.some((row) => row === null)) return null;
  return {
    schema: result.schema,
    rows: rows.filter((row): row is Record<string, unknown> => row !== null),
    totalCount: result.totalCount,
    page: {
      offset: page.offset,
      limit: page.limit,
      returned: page.returned,
    },
  };
}

function boundedFrameRows(
  schema: FrameField[],
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const field of schema) {
      if (Object.hasOwn(row, field.id)) projected[field.id] = row[field.id];
      else if (Object.hasOwn(row, field.name))
        projected[field.id] = row[field.name];
      else projected[field.id] = null;
    }
    return projected;
  });
}

function frameFreshness(entry: Record<string, unknown>): {
  state: "fresh" | "snapshot" | "stale";
  fetchedAt?: number;
} {
  const fetchedAt =
    typeof entry.lastRefreshedAt === "number" &&
    Number.isFinite(entry.lastRefreshedAt)
      ? entry.lastRefreshedAt
      : undefined;
  let state: "fresh" | "snapshot" | "stale" = "snapshot";
  if (typeof entry.insightId === "string") {
    state = entry.currentInsightResult === true ? "fresh" : "stale";
  }
  return { state, ...(fetchedAt === undefined ? {} : { fetchedAt }) };
}

function frameTitle(value: unknown): string {
  return typeof value === "string" ? value : "DashFrame data report";
}

function renderDataFrameTool(
  app: ApplicationOperations,
  context: McpRequestContext,
): McpTool {
  const closed = { additionalProperties: false };
  const inputSchema = Type.Object(
    {
      dataFrameId: Type.String({
        format: "uuid",
        description:
          "Server-minted immutable DataFrame id returned by fetch_data, " +
          "run_insight, or another DashFrame data tool.",
      }),
      title: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 120,
          description: "Short user-facing report title.",
        }),
      ),
      view: Type.Optional(
        Type.Union(
          ["table", "chart", "overview"].map((value) => Type.Literal(value)),
          {
            description:
              "Focused inline presentation. Use table by default, chart for " +
              "a numeric trend, or overview only when chart and table both " +
              "add distinct value.",
          },
        ),
      ),
    },
    closed,
  );
  const fieldSchema = Type.Object(
    {
      id: Type.String(),
      name: Type.String(),
      type: Type.String(),
    },
    closed,
  );
  const pageSchema = Type.Object(
    {
      offset: Type.Integer({ minimum: 0 }),
      limit: Type.Integer({ minimum: 1, maximum: REPORT_PREVIEW_LIMIT }),
      returned: Type.Integer({ minimum: 0, maximum: REPORT_PREVIEW_LIMIT }),
    },
    closed,
  );
  // MCP tool output schemas must themselves be JSON Schema objects. Keep the
  // discriminant required and branch-specific fields optional at this wire
  // boundary; the handler still returns one complete ready or failed shape.
  const outputSchema = Type.Object(
    {
      status: Type.Union([Type.Literal("ready"), Type.Literal("failed")]),
      report: Type.Optional(
        Type.Object(
          {
            title: Type.String(),
            view: Type.Union([
              Type.Literal("table"),
              Type.Literal("chart"),
              Type.Literal("overview"),
            ]),
            dataFrameId: Type.String({ format: "uuid" }),
            schema: Type.Array(fieldSchema, { maxItems: REPORT_SCHEMA_LIMIT }),
            rows: Type.Array(Type.Record(Type.String(), Type.Any()), {
              maxItems: REPORT_PREVIEW_LIMIT,
            }),
            columnCount: Type.Integer({ minimum: 0 }),
            totalCount: Type.Integer({ minimum: 0 }),
            page: pageSchema,
            freshness: Type.Object(
              {
                state: Type.Union([
                  Type.Literal("fresh"),
                  Type.Literal("snapshot"),
                  Type.Literal("stale"),
                ]),
                fetchedAt: Type.Optional(Type.Number()),
              },
              closed,
            ),
          },
          closed,
        ),
      ),
      code: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
    },
    closed,
  );

  return {
    name: "render_data_frame",
    title: "Render DashFrame report",
    description:
      "Use this when the user should see a DashFrame report inline. First " +
      "materialize or locate a server-owned DataFrame with fetch_data, " +
      "run_insight, or another data tool, then pass its dataFrameId here. " +
      "Returns a bounded report preview and remains useful as structured data " +
      "when the host cannot render MCP Apps.",
    inputSchema,
    outputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: {
      ui: {
        resourceUri: REPORT_APP_URI,
        visibility: ["model", "app"],
      },
      "openai/outputTemplate": REPORT_APP_URI,
      "openai/widgetAccessible": true,
      "openai/toolInvocation/invoking": "Preparing report…",
      "openai/toolInvocation/invoked": "Report ready",
    },
    async execute(args) {
      const checked = validateToolArgs(inputSchema, args);
      if (!checked.ok) throw new Error(checked.error.message);
      const { dataFrameId, view = "table" } = checked.value as {
        dataFrameId: string;
        title?: string;
        view?: "table" | "chart" | "overview";
      };
      const [entryResponse, pageResponse] = await Promise.all([
        app.execute(
          "getDataFrameEntry",
          { id: dataFrameId },
          { principal: context.principal },
        ),
        app.execute(
          "queryDataFrame",
          { dataFrameId, offset: 0, limit: REPORT_INITIAL_PAGE_LIMIT },
          { principal: context.principal },
        ),
      ]);
      const rawPage = frameEntry(pageResponse) ?? {};
      const page = readyFramePage(rawPage);
      if (page === null) return frameFailure(rawPage);
      const entry = frameEntry(entryResponse);
      if (entry === null) {
        return frameFailure({ code: "FRAME_NOT_FOUND" });
      }
      const freshness = frameFreshness(entry);
      const title = frameTitle((checked.value as { title?: unknown }).title);
      const schema = page.schema.slice(0, REPORT_SCHEMA_LIMIT);
      const report = {
        status: "ready" as const,
        report: {
          title,
          view,
          dataFrameId,
          schema,
          rows: boundedFrameRows(schema, page.rows),
          columnCount: page.schema.length,
          totalCount: page.totalCount,
          page: page.page,
          freshness,
        },
      };
      return {
        content: [
          {
            type: "text",
            text:
              `${title}: ${String(page.totalCount)} rows across ` +
              `${page.schema.length} columns. ` +
              "The structured result contains a bounded preview; use " +
              "query_data_frame for additional pages.",
          },
        ],
        structuredContent: report,
      };
    },
  };
}

function createDataTools(
  app: ApplicationOperations,
  context: McpRequestContext,
): McpTool[] {
  const closed = { additionalProperties: false };
  const filter = Type.Object(
    {
      id: Type.Optional(Type.String()),
      field: Type.String({ minLength: 1 }),
      operator: Type.Union([
        Type.Literal("eq"),
        Type.Literal("ne"),
        Type.Literal("gt"),
        Type.Literal("gte"),
        Type.Literal("lt"),
        Type.Literal("lte"),
        Type.Literal("contains"),
        Type.Literal("in"),
        Type.Literal("between"),
      ]),
      value: Type.Any(),
    },
    closed,
  );
  const insight = Type.Object(
    {
      baseTableId: Type.String({ minLength: 1 }),
      selectedFields: Type.Array(Type.String({ minLength: 1 })),
      metrics: Type.Array(
        Type.Object(
          {
            id: Type.String(),
            name: Type.String(),
            sourceTable: Type.String(),
            columnName: Type.Optional(Type.String()),
            aggregation: Type.Union(
              ["sum", "avg", "count", "min", "max", "count_distinct"].map(
                (value) => Type.Literal(value),
              ),
            ),
          },
          closed,
        ),
      ),
      filters: Type.Optional(Type.Array(filter)),
      sorts: Type.Optional(
        Type.Array(
          Type.Object(
            {
              field: Type.String(),
              direction: Type.Union([
                Type.Literal("asc"),
                Type.Literal("desc"),
              ]),
            },
            closed,
          ),
        ),
      ),
      joins: Type.Optional(
        Type.Array(
          Type.Object(
            {
              type: Type.Union(
                ["inner", "left", "right", "full"].map((value) =>
                  Type.Literal(value),
                ),
              ),
              rightTableId: Type.String(),
              leftKey: Type.String(),
              rightKey: Type.String(),
            },
            closed,
          ),
        ),
      ),
    },
    closed,
  );
  const savedRuntime = Type.Object(
    {
      filters: Type.Optional(Type.Record(Type.String(), Type.Any())),
      sort: Type.Optional(
        Type.Array(
          Type.Object(
            {
              fieldId: Type.String(),
              direction: Type.Union([
                Type.Literal("asc"),
                Type.Literal("desc"),
              ]),
            },
            closed,
          ),
          { maxItems: 1 },
        ),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    closed,
  );
  const queryOutputSchema = Type.Object(
    {
      status: Type.Union([Type.Literal("ready"), Type.Literal("failed")]),
      schema: Type.Optional(Type.Array(frameFieldSchema)),
      rows: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
      totalCount: Type.Optional(Type.Integer({ minimum: 0 })),
      page: Type.Optional(
        Type.Object(
          {
            offset: Type.Integer({ minimum: 0 }),
            limit: Type.Integer({ minimum: 1, maximum: DATA_QUERY_MAX_LIMIT }),
            returned: Type.Integer({
              minimum: 0,
              maximum: DATA_QUERY_MAX_LIMIT,
            }),
          },
          closed,
        ),
      ),
      code: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
    },
    {
      ...closed,
      oneOf: [
        Type.Object(
          {
            status: Type.Literal("ready"),
            schema: Type.Array(frameFieldSchema),
            rows: Type.Array(Type.Record(Type.String(), Type.Any())),
            totalCount: Type.Integer({ minimum: 0 }),
            page: Type.Object(
              {
                offset: Type.Integer({ minimum: 0 }),
                limit: Type.Integer({
                  minimum: 1,
                  maximum: DATA_QUERY_MAX_LIMIT,
                }),
                returned: Type.Integer({
                  minimum: 0,
                  maximum: DATA_QUERY_MAX_LIMIT,
                }),
              },
              closed,
            ),
          },
          closed,
        ),
        Type.Object(
          {
            status: Type.Literal("failed"),
            code: Type.String(),
            message: Type.String(),
          },
          closed,
        ),
      ],
    },
  );
  return [
    dataTool(
      app,
      context,
      "fetch_data",
      "Materialize an ephemeral Insight result from an already configured DashFrame source. Returns reusable frame metadata only, never rows or credentials.",
      Type.Object({ insight }, closed),
      materializationOutputSchema,
      "fetchData",
    ),
    dataTool(
      app,
      context,
      "run_insight",
      "Materialize a saved Insight under its distinct authorization and durable-generation lifecycle. Returns reusable frame metadata only, never rows or credentials.",
      Type.Object(
        {
          insightId: Type.String({ format: "uuid" }),
          runtime: Type.Optional(savedRuntime),
        },
        closed,
      ),
      materializationOutputSchema,
      "runInsight",
    ),
    dataTool(
      app,
      context,
      "query_data_frame",
      "Read one bounded page from a project-owned DataFrame. Accepts no SQL, table name, provider, credential, or paging token.",
      Type.Object(
        {
          dataFrameId: Type.String({ format: "uuid" }),
          offset: Type.Optional(
            Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          ),
          limit: Type.Optional(
            Type.Integer({ minimum: 1, maximum: DATA_QUERY_MAX_LIMIT }),
          ),
          sort: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  fieldId: Type.String({ minLength: 1 }),
                  direction: Type.Union([
                    Type.Literal("asc"),
                    Type.Literal("desc"),
                  ]),
                },
                closed,
              ),
              { maxItems: 5 },
            ),
          ),
        },
        closed,
      ),
      queryOutputSchema,
      "queryDataFrame",
    ),
    renderDataFrameTool(app, context),
  ];
}

/** One entry of the write tool's batch, as the agent supplies it. */
interface DraftBatchCommandInput {
  type: string;
  args: Record<string, unknown>;
}

const MCP_DENIED_DRAFT_COMMANDS = new Set(["SetDataSourceConfig"]);

function isMcpDraftSafeCommand(name: string): boolean {
  return DRAFT_SAFE_COMMANDS.has(name) && !MCP_DENIED_DRAFT_COMMANDS.has(name);
}

function draftSafeCommandList(): string {
  return [...DRAFT_SAFE_COMMANDS]
    .filter((name) => isMcpDraftSafeCommand(name))
    .sort()
    .join(", ");
}

function mcpCommandSummary(name: string, fallback: string): string {
  if (name === "CreateDataSource") {
    return "Create a credential-free data source.";
  }
  return fallback;
}

function renderMcpCommandGuide(): string {
  const lines = [
    "# Command vocabulary (primary reference)",
    "Each command is applied by name. Credential setup is intentionally",
    "excluded from this MCP surface.",
    "",
  ];
  let group = "";
  for (const entry of COMMAND_GUIDE) {
    if (!isMcpDraftSafeCommand(entry.name)) continue;
    if (entry.group !== group) {
      group = entry.group;
      lines.push(`## ${group}`);
    }
    const credentialFields = new Set(
      CREDENTIAL_COMMAND_ARG_FIELDS[entry.name] ?? [],
    );
    const args = Object.entries(entry.args)
      .filter(
        ([name]) =>
          !credentialFields.has(
            name.replace(/\?$/, "") as "apiKey" | "connectionString",
          ),
      )
      .map(([name, description]) => `${name}: ${description}`)
      .join(", ");
    const summary = mcpCommandSummary(entry.name, entry.summary);
    lines.push(`- ${entry.name} — ${summary}`);
    lines.push(`  args: { ${args} }`);
    if (entry.name in CREDENTIAL_COMMAND_ARG_FIELDS) {
      lines.push(
        "  note: Credential fields and secret references are rejected. Configure " +
          "credentials in DashFrame's trusted UI or provider OAuth flow.",
      );
    } else if (entry.notes) {
      lines.push(`  note: ${entry.notes}`);
    }
  }
  return lines.join("\n");
}

/**
 * The write tool's description carries the whole command vocabulary inline.
 * An MCP client sees tool descriptions and nothing else before it calls, so a
 * guide behind a second round trip is a guide the agent will not read.
 */
function draftBatchDescription(mode: McpMode): string {
  const continuity =
    mode === "stateless"
      ? [
          "draft, never commit. Carry the returned draftId forward: pass it on later",
          "draft_batch calls to append, and on read tools to see the draft overlay.",
        ]
      : [
          "draft, never commit. The server carries the returned draftId for this",
          "session, so later writes and reads continue against the same overlay.",
        ];
  return [
    "Append a batch of draft-safe DashFrame commands to a DashFrame draft.",
    "Nothing here reaches canonical state; only a person can publish the draft.",
    "The batch is atomic: if any command fails, none of its commands are saved.",
    "An existing draft stays unchanged; a failed first batch creates no draftId.",
    "After a command validation failure, correct and resubmit the entire batch.",
    ...continuity,
    "",
    "Each entry is { type, args } where `type` is a command NAME from the guide",
    "below (not a registry path).",
    `Allowed here: ${draftSafeCommandList()}.`,
    "",
    "Refused at this boundary — do not retry these, they will never succeed:",
    "- DeleteNode. Deletion includes host resource cleanup. Ask a person to delete.",
    "- GetOrCreateDataSource. Use CreateDataSource without credential fields;",
    "  the get-or-create path predates the current draft treatment.",
    "- SetDataSourceConfig. Its open-ended connector config cannot prove that",
    "  nested values are credential-free, so configuration stays in DashFrame.",
    "- Credential material in CreateDataSource. The",
    "  ChatGPT plugin never accepts credentials. Configure them in DashFrame's",
    "  trusted UI or provider OAuth flow, then retry without credential fields.",
    "- Lifecycle procedures (publishDraft, commitBatch, discardDraft,",
    "  reviseDraft). These are not commands and are not on this surface at all.",
    "  Publishing is a person's decision.",
    "",
    renderMcpCommandGuide(),
  ].join("\n");
}

function containsCredentialMaterial(value: unknown): boolean {
  if (isSecretRef(value)) return true;
  if (Array.isArray(value)) return value.some(containsCredentialMaterial);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      /api.?key|connection.?string|password|secret|token|auth.?ref/i.test(
        key,
      ) || containsCredentialMaterial(child),
  );
}

/**
 * The MCP-only policy gate, applied to command NAMES before anything is
 * lowered to a registry path. `draftBatch` itself only checks path membership,
 * so this is the layer that denies `DeleteNode` and `GetOrCreateDataSource`.
 */
function assertDraftSafeBatch(
  commands: readonly DraftBatchCommandInput[],
): void {
  for (const { type, args } of commands) {
    if (!isMcpDraftSafeCommand(type)) {
      throw new Error(
        `${DRAFT_BATCH_TOOL_NAME}: command "${type}" is not draft-safe. ` +
          `Use one of: ${draftSafeCommandList()}.`,
      );
    }
    if (!(type in COMMAND_PATHS)) {
      throw new Error(
        `${DRAFT_BATCH_TOOL_NAME}: command "${type}" is not a known DashFrame ` +
          "command name.",
      );
    }
    if (
      type in CREDENTIAL_COMMAND_ARG_FIELDS &&
      containsCredentialMaterial(args)
    ) {
      throw new Error(
        `${DRAFT_BATCH_TOOL_NAME}: credential material is not accepted through ` +
          "MCP. Configure the source credential in DashFrame's trusted UI or " +
          "provider OAuth flow, then retry without credential fields.",
      );
    }
  }
}

/**
 * Lower command names to the registry envelopes `draftBatch` expects.
 * `assertKnownCommandPaths` runs afterwards as defence in depth: the
 * name-level allow-list above is the primary gate, but if `COMMAND_PATHS` ever
 * drifts from the registry, the server's own vocabulary check still fires.
 */
function lowerCommands(commands: readonly DraftBatchCommandInput[]): Command[] {
  const lowered = commands.map(({ type, args }) =>
    cmd(type as CommandName, args as CommandPayloads[CommandName]),
  );
  assertKnownCommandPaths(lowered, DRAFT_BATCH_TOOL_NAME);
  return lowered;
}

/**
 * The reader is deliberately a forwarder: each read snapshots the current
 * handle, whether caller-supplied in stateless mode or retained by a stateful
 * session, rather than binding a handle when tools are listed.
 */
function createDelegatingReader(
  app: ApplicationOperations,
  draftId: string | undefined,
): GraphReader {
  return new Proxy({} as GraphReader, {
    get(_target, property: keyof GraphReader) {
      return async (...args: unknown[]) => {
        const reader = createAssistantReadHost({
          app,
          ...(draftId === undefined ? {} : { draftId }),
        });
        const method = reader[property] as (...values: unknown[]) => unknown;
        return method.apply(reader, args);
      };
    },
  });
}

async function assertDraftOpen(
  app: ApplicationOperations,
  context: McpRequestContext,
  draftId: string | undefined,
): Promise<void> {
  if (draftId === undefined) return;
  const listed = await app.execute(
    "listDrafts",
    {},
    { principal: context.principal },
  );
  const drafts = listed as Array<{ draftId: string }>;
  if (!drafts.some((draft) => draft.draftId === draftId)) {
    throw new Error(DRAFT_UNAVAILABLE);
  }
}

/** Cap on the id line; a whole-graph `find_nodes` can return a lot. */
const MAX_SURFACED_REFS = 50;

/**
 * Collect every `{ ref: { kind, id }, name }` the read layer produced, in
 * encounter order, deduped.
 */
function collectRefs(
  value: unknown,
  out: Map<string, { kind: string; id: string; name?: string }>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  const ref = record.ref as { kind?: unknown; id?: unknown } | undefined;
  if (typeof ref?.kind === "string" && typeof ref.id === "string") {
    const key = `${ref.kind}:${ref.id}`;
    if (!out.has(key)) {
      out.set(key, {
        kind: ref.kind,
        id: ref.id,
        ...(typeof record.name === "string" ? { name: record.name } : {}),
      });
    }
  }
  for (const nested of Object.values(record)) collectRefs(nested, out);
}

/**
 * The read tools narrate results by name, and put the ids only in `details`.
 * Keep the ids in text as a compatibility fallback for clients that do not
 * surface structured output even though every MCP tool now declares a schema.
 */
function refLine(details: unknown): string | null {
  const refs = new Map<string, { kind: string; id: string; name?: string }>();
  collectRefs(details, refs);
  if (refs.size === 0) return null;
  const shown = [...refs.values()].slice(0, MAX_SURFACED_REFS);
  const rendered = shown
    .map((ref) =>
      ref.name === undefined
        ? `${ref.kind} ${ref.id}`
        : `${ref.name} — ${ref.kind} ${ref.id}`,
    )
    .join("; ");
  const omitted = refs.size - shown.length;
  return omitted > 0
    ? `Ids: ${rendered}; and ${omitted} more.`
    : `Ids: ${rendered}`;
}

function toMcpTool(
  tool: AssistantTool,
  isReadTool: boolean,
  mode: McpMode,
  app: ApplicationOperations,
  context: McpRequestContext,
): McpTool {
  const inputSchema =
    isReadTool && mode === "stateless"
      ? {
          ...tool.parameters,
          properties: {
            ...(tool.parameters as { properties: Record<string, TSchema> })
              .properties,
            draftId: Type.Optional(
              Type.String({
                description:
                  "Draft id from draft_batch. Pass it to read through that " +
                  "draft's overlay; omit to read canonical state.",
              }),
            ),
          },
        }
      : tool.parameters;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema,
    outputSchema: outputSchemaForAssistantTool(tool.name, isReadTool),
    annotations: isReadTool
      ? READ_ONLY_ANNOTATIONS
      : {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
    async execute(args) {
      const requestDraftId = isReadTool ? context.draftId : undefined;
      const isReadArgs =
        isReadTool &&
        mode === "stateless" &&
        typeof args === "object" &&
        args !== null &&
        !Array.isArray(args);
      if (
        isReadArgs &&
        Object.hasOwn(args, "draftId") &&
        typeof (args as Record<string, unknown>).draftId !== "string"
      ) {
        throw new Error(
          "Tool argument validation failed: /draftId must be string",
        );
      }
      const toolArgs = isReadArgs
        ? (() => {
            const rest = { ...(args as Record<string, unknown>) };
            delete rest.draftId;
            return rest;
          })()
        : args;
      const checked = validateToolArgs(tool.parameters, toolArgs);
      if (!checked.ok) throw new Error(checked.error.message);
      if (isReadTool) await assertDraftOpen(app, context, requestDraftId);
      const executionTool = isReadTool
        ? (Object.values(
            createReadTools(
              createDelegatingReader(
                app.forPrincipal(checkedPrincipal(context.principal)),
                requestDraftId,
              ),
            ),
          ).find((candidate) => candidate.name === tool.name) as AssistantTool)
        : tool;
      const result = await executionTool.execute(
        crypto.randomUUID(),
        checked.value as never,
      );
      // A person can close the exact captured handle during the read. Refuse
      // that result instead of falling through to canonical or a replacement.
      if (isReadTool) await assertDraftOpen(app, context, requestDraftId);
      const ids = isReadTool ? refLine(result.details) : null;
      return {
        content:
          ids === null
            ? result.content
            : [...result.content, { type: "text" as const, text: ids }],
        ...(typeof result.details === "object" && result.details !== null
          ? { structuredContent: result.details as Record<string, unknown> }
          : {}),
      };
    },
  };
}

function checkedPrincipal(principal: unknown) {
  if (!isPrincipal(principal)) throw new Error("Unauthorized");
  return principal;
}

export function createMcpTools(
  app: ApplicationOperations,
  context: McpRequestContext,
  mode: McpMode,
): McpTool[] {
  let statefulAppendTail: Promise<void> = Promise.resolve();
  async function serializeStatefulAppend<T>(run: () => Promise<T>): Promise<T> {
    const current = statefulAppendTail.catch(() => {}).then(run);
    statefulAppendTail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }
  async function recoverClosedStatefulDraft<T extends { draftId: string }>(
    error: unknown,
    rememberedDraftId: string | undefined,
    append: (draftId: string | undefined) => Promise<T>,
  ): Promise<T> {
    if (
      mode !== "stateful" ||
      rememberedDraftId === undefined ||
      !(error instanceof Error) ||
      !error.message.includes(DRAFT_UNAVAILABLE)
    ) {
      throw error;
    }
    context.draftId = undefined;
    const result = await append(undefined);
    context.draftId = result.draftId;
    return result;
  }
  const readTools = Object.values(
    createReadTools(createDelegatingReader(app, undefined)),
  ) as AssistantTool[];

  const writeTool = defineToolHandler({
    name: DRAFT_BATCH_TOOL_NAME,
    description: draftBatchDescription(mode),
    label: "Draft batch",
    executionMode: "sequential",
    parameters: Type.Object({
      ...(mode === "stateless"
        ? {
            draftId: Type.Optional(
              Type.String({
                description:
                  "Draft id returned by an earlier draft_batch call. Omit " +
                  "to open a new draft.",
              }),
            ),
          }
        : {}),
      commands: Type.Array(
        Type.Object({
          type: Type.String({
            description:
              "Draft-safe DashFrame command name from the guide below, e.g. " +
              "CreateDataSource or CreateVisualization. Not a registry path.",
          }),
          args: Type.Record(Type.String(), Type.Any(), {
            description:
              "Arguments for that command. Credential-bearing commands and " +
              "credential fields are not available through this plugin.",
          }),
        }),
        {
          minItems: 1,
          description: "One or more draft-safe artifact commands.",
        },
      ),
    }),
    async execute(_toolCallId, params) {
      const batch = params.commands as DraftBatchCommandInput[];
      assertDraftSafeBatch(batch);
      const commands = lowerCommands(batch);

      const append = async (
        draftId: string | undefined,
      ): Promise<{ draftId: string }> => {
        const response = await app.execute(
          "draftBatch",
          { commands, ...(draftId === undefined ? {} : { draftId }) },
          { principal: context.principal },
        );
        return response as { draftId: string };
      };

      const performAppend = async () => {
        const draftId =
          mode === "stateless"
            ? (params as { draftId?: string }).draftId
            : context.draftId;
        try {
          const result = await append(draftId);
          if (mode === "stateful") context.draftId = result.draftId;
          return result;
        } catch (error) {
          // A remembered stateful handle is server-owned session state. Once a
          // person closes it, the next write starts a new owned draft. Stateless
          // caller-supplied handles never receive this fallback.
          return recoverClosedStatefulDraft(error, draftId, append);
        }
      };
      const result =
        mode === "stateful"
          ? await serializeStatefulAppend(performAppend)
          : await performAppend();
      return {
        content: [
          {
            type: "text" as const,
            text: `Appended ${commands.length} command(s) to draft ${result.draftId}.`,
          },
        ],
        details: {
          draftId: result.draftId,
          commandCount: commands.length,
        },
      };
    },
  });

  return [
    ...readTools.map((tool) => toMcpTool(tool, true, mode, app, context)),
    ...createDataTools(app, context),
    toMcpTool(writeTool as AssistantTool, false, mode, app, context),
  ];
}

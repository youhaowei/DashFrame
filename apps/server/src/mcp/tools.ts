import {
  createReadTools,
  CREDENTIAL_COMMAND_ARG_FIELDS,
  defineToolHandler,
  DRAFT_SAFE_COMMANDS,
  renderCommandGuide,
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
import type { WyStackApp } from "@wystack/server";

import { createAssistantReadHost } from "../assistant-read-host";
import { DRAFT_UNAVAILABLE } from "../draft-access";
import { assertKnownCommandPaths } from "../functions/commands";
import { draftIdFromBatchError } from "../functions/draft-batch";
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

function dataTool(
  app: WyStackApp,
  context: McpRequestContext,
  name: string,
  description: string,
  inputSchema: TSchema,
  path: "fetchData" | "runInsight" | "queryDataFrame",
): McpTool {
  return {
    name,
    description,
    inputSchema,
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
      const response = await app.call(path, checked.value, {
        principal: context.principal,
      });
      const result = response.result as Record<string, unknown>;
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
  app: WyStackApp,
  context: McpRequestContext,
): McpTool {
  const closed = { additionalProperties: false };
  const inputSchema = Type.Object(
    {
      dataFrameId: Type.String({
        format: "uuid",
        description:
          "Server-minted immutable DataFrame id returned by fetch_data, " +
          "run_insight, or another DashFrame read tool.",
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
      "run_insight, or another read tool, then pass its dataFrameId here. " +
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
        app.call(
          "getDataFrameEntry",
          { id: dataFrameId },
          { principal: context.principal },
        ),
        app.call(
          "queryDataFrame",
          { dataFrameId, offset: 0, limit: REPORT_INITIAL_PAGE_LIMIT },
          { principal: context.principal },
        ),
      ]);
      const rawPage = frameEntry(pageResponse.result) ?? {};
      const page = readyFramePage(rawPage);
      if (page === null) return frameFailure(rawPage);
      const entry = frameEntry(entryResponse.result);
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
  app: WyStackApp,
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
  return [
    dataTool(
      app,
      context,
      "fetch_data",
      "Materialize an ephemeral Insight result. Returns metadata only, never rows or credentials.",
      Type.Object({ insight }, closed),
      "fetchData",
    ),
    dataTool(
      app,
      context,
      "run_insight",
      "Materialize a saved Insight result. Returns metadata only, never rows or credentials.",
      Type.Object(
        {
          insightId: Type.String({ format: "uuid" }),
          runtime: Type.Optional(
            Type.Object(
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
            ),
          ),
        },
        closed,
      ),
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

function draftSafeCommandList(): string {
  return [...DRAFT_SAFE_COMMANDS].sort().join(", ");
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
    "Nothing here reaches canonical state: the draft opens before commands run,",
    "and only a person can publish it. If a later command fails after an earlier",
    "prefix committed, the error retains the owned draftId so that work can",
    "continue. API credentials can",
    ...continuity,
    "",
    "Each entry is { type, args } where `type` is a command NAME from the guide",
    "below (not a registry path).",
    `Allowed here: ${draftSafeCommandList()}.`,
    "",
    "Refused at this boundary — do not retry these, they will never succeed:",
    "- DeleteNode. Deleting a node touches the credential vault and cascades in",
    "  ways a draft cannot roll back. Ask a person to delete.",
    "- GetOrCreateDataSource. Use CreateDataSource, which handles credentials",
    "  correctly; the get-or-create path predates that treatment.",
    "- Lifecycle procedures (publishDraft, commitBatch, discardDraft,",
    "  reviseDraft). These are not commands and are not on this surface at all.",
    "  Publishing is a person's decision.",
    "- A secret reference (secret:<uuid>) in a credential field. Send the",
    "  plaintext value; the server stores it and hands back the reference.",
    "",
    renderCommandGuide(),
  ].join("\n");
}

function hasCallerSuppliedSecretRef(value: unknown): boolean {
  if (isSecretRef(value)) return true;
  if (Array.isArray(value)) return value.some(hasCallerSuppliedSecretRef);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasCallerSuppliedSecretRef);
  }
  return false;
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
    if (!DRAFT_SAFE_COMMANDS.has(type)) {
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
      hasCallerSuppliedSecretRef(args)
    ) {
      throw new Error(
        `${DRAFT_BATCH_TOOL_NAME}: credential arguments must contain plaintext ` +
          "values, not caller-supplied secret references.",
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
  app: WyStackApp,
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
  app: WyStackApp,
  context: McpRequestContext,
  draftId: string | undefined,
): Promise<void> {
  if (draftId === undefined) return;
  const listed = await app.call(
    "listDrafts",
    {},
    { principal: context.principal },
  );
  const drafts = listed.result as Array<{ draftId: string }>;
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
 * That is fine for a client that reads structured output, but this server
 * declares no outputSchema, so whether a client surfaces `structuredContent`
 * to the model is the client's choice. An agent that only sees the text would
 * know an artifact exists and have no id to pass to the next call, so the ids
 * go in the text too.
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
  app: WyStackApp,
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
            createReadTools(createDelegatingReader(app, requestDraftId)),
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

export function createMcpTools(
  app: WyStackApp,
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
  function retainStatefulDraft(error: unknown): void {
    if (mode !== "stateful") return;
    const retainedDraftId = draftIdFromBatchError(error);
    if (retainedDraftId !== undefined) context.draftId = retainedDraftId;
  }
  async function recoverClosedStatefulDraft<T extends { draftId: string }>(
    error: unknown,
    rememberedDraftId: string | undefined,
    append: (draftId: string | undefined) => Promise<T>,
  ): Promise<T> {
    retainStatefulDraft(error);
    if (
      mode !== "stateful" ||
      rememberedDraftId === undefined ||
      !(error instanceof Error) ||
      error.message !== DRAFT_UNAVAILABLE
    ) {
      throw error;
    }
    context.draftId = undefined;
    try {
      const result = await append(undefined);
      context.draftId = result.draftId;
      return result;
    } catch (retryError) {
      retainStatefulDraft(retryError);
      throw retryError;
    }
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
              "Arguments for that command. Credential fields carry the " +
              "plaintext value, never a secret reference.",
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
      ): Promise<{ draftId: string; results: unknown[] }> => {
        const response = await app.call(
          "draftBatch",
          { commands, ...(draftId === undefined ? {} : { draftId }) },
          { principal: context.principal },
        );
        return response.result as { draftId: string; results: unknown[] };
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
          results: result.results,
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

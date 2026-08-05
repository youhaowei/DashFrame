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
import { assertKnownCommandPaths } from "../functions/commands";
import type { McpSession } from "./route";

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
  description: string;
  inputSchema: TSchema;
  execute(args: unknown): Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
  }>;
}

/** The write tool's name — snake_case, matching the read tools. */
export const DRAFT_BATCH_TOOL_NAME = "draft_batch";

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
function draftBatchDescription(): string {
  return [
    "Append a batch of draft-safe DashFrame commands to this session's draft.",
    "Nothing here reaches canonical state: the draft opens on the first",
    "successful call, is reused for the rest of the session, and only a person",
    "can publish it. API credentials can draft, never commit.",
    "",
    "Each entry is { type, args } where `type` is a command NAME from the guide",
    "below (not a registry path). Do not pass a draft id — this tool holds it.",
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
    "Reads before the first write see canonical state; reads afterwards see the",
    "draft overlay, so you can read back what you just wrote.",
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
 * `draftBatch` rejects a handle it cannot find with exactly this phrasing
 * (`draftBatch: no open draft <id>`), and nothing else on that path produces
 * it. Matching the text is the narrowest available signal — the RPC layer
 * carries no error codes — so it is kept deliberately specific rather than
 * matching anything draft-shaped.
 */
function isMissingDraftError(error: unknown): boolean {
  if (error instanceof Error) return error.message.includes("no open draft");
  if (typeof error === "string") return error.includes("no open draft");
  return false;
}

/**
 * The reader is deliberately a forwarder: the draft id belongs to the MCP
 * session and is looked up when each read executes, not when tools are listed.
 */
function createDelegatingReader(
  app: WyStackApp,
  session: McpSession,
): GraphReader {
  return new Proxy({} as GraphReader, {
    get(_target, property: keyof GraphReader) {
      return (...args: unknown[]) => {
        const reader = createAssistantReadHost({
          app,
          ...(session.draftId === undefined
            ? {}
            : { draftId: session.draftId }),
        });
        const method = reader[property] as (...values: unknown[]) => unknown;
        return method.apply(reader, args);
      };
    },
  });
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

function toMcpTool(tool: AssistantTool, surfaceRefs: boolean): McpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
    async execute(args) {
      const checked = validateToolArgs(tool.parameters, args);
      if (!checked.ok) throw new Error(checked.error.message);
      const result = await tool.execute(
        crypto.randomUUID(),
        checked.value as never,
      );
      const ids = surfaceRefs ? refLine(result.details) : null;
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
  session: McpSession,
): McpTool[] {
  const readTools = Object.values(
    createReadTools(createDelegatingReader(app, session)),
  ) as AssistantTool[];

  const writeTool = defineToolHandler({
    name: DRAFT_BATCH_TOOL_NAME,
    description: draftBatchDescription(),
    label: "Draft batch",
    executionMode: "sequential",
    parameters: Type.Object({
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
          { principal: session.principal },
        );
        return response.result as { draftId: string; results: unknown[] };
      };

      // The session's draft is not the session's to keep: a person can publish
      // or discard it at any moment, and `deleteDraftMetadata` then makes the
      // remembered id unknown to `draftBatch` forever. The agent cannot rescue
      // itself — this tool holds the id and never accepts one — so a stale
      // handle would brick every remaining write on the connection. Forget it
      // and open a fresh draft instead. Retried once, and only for this error:
      // any other failure is the caller's to see.
      let result: { draftId: string; results: unknown[] };
      try {
        result = await append(session.draftId);
      } catch (error) {
        if (session.draftId === undefined || !isMissingDraftError(error)) {
          throw error;
        }
        session.draftId = undefined;
        result = await append(undefined);
      }
      session.draftId = result.draftId;
      return {
        content: [
          {
            type: "text" as const,
            text: `Appended ${commands.length} command(s) to the session draft.`,
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
    ...readTools.map((tool) => toMcpTool(tool, true)),
    toMcpTool(writeTool as AssistantTool, false),
  ];
}

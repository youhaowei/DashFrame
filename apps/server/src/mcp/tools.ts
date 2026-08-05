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

function toMcpTool(tool: AssistantTool): McpTool {
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
      return {
        content: result.content,
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
      const response = await app.call(
        "draftBatch",
        {
          commands,
          ...(session.draftId === undefined
            ? {}
            : { draftId: session.draftId }),
        },
        { principal: session.principal },
      );
      const result = response.result as { draftId: string; results: unknown[] };
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

  return [...readTools.map(toMcpTool), toMcpTool(writeTool as AssistantTool)];
}

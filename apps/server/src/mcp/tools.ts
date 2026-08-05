import {
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
  COMMAND_PATHS,
  type Command,
  type CommandName,
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

const commandNameByPath = new Map<string, CommandName>(
  Object.entries(COMMAND_PATHS).map(([name, path]) => [
    path,
    name as CommandName,
  ]),
);

function hasCallerSuppliedSecretRef(value: unknown): boolean {
  if (isSecretRef(value)) return true;
  if (Array.isArray(value)) return value.some(hasCallerSuppliedSecretRef);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasCallerSuppliedSecretRef);
  }
  return false;
}

function assertDraftSafeBatch(commands: readonly Command[]): void {
  // Keep the lifecycle/unknown-path diagnostic owned by the server's existing
  // vocabulary gate; it must run before the MCP-only safe-command policy.
  assertKnownCommandPaths(commands, "applyCommandBatch");

  for (const command of commands) {
    const name = commandNameByPath.get(command.path);
    if (name === undefined || !DRAFT_SAFE_COMMANDS.has(name)) {
      throw new Error(
        "applyCommandBatch: this command is not draft-safe. Use an additive or " +
          "update command from the DashFrame command guide instead.",
      );
    }
    if (
      name in CREDENTIAL_COMMAND_ARG_FIELDS &&
      hasCallerSuppliedSecretRef(command.args)
    ) {
      throw new Error(
        "applyCommandBatch: credential arguments must contain plaintext values, " +
          "not caller-supplied secret references.",
      );
    }
  }
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
    name: "applyCommandBatch",
    description:
      "Append a batch of draft-safe DashFrame commands to this MCP session's " +
      "draft. Commands are never committed to canonical state here. Use the " +
      "existing read tools and command guide to choose valid command paths and " +
      "argument shapes. Do not include a draft id; this session opens one only " +
      "after its first successful write. Credential fields must use plaintext, " +
      "never a secret reference.",
    label: "Apply command batch",
    executionMode: "sequential",
    parameters: Type.Object({
      commands: Type.Array(
        Type.Object({
          path: Type.String({
            description:
              "DashFrame command registry path from the command guide.",
          }),
          args: Type.Unknown({
            description: "Arguments for that command path.",
          }),
        }),
        {
          minItems: 1,
          description: "One or more draft-safe artifact commands.",
        },
      ),
    }),
    async execute(_toolCallId, params) {
      const commands = params.commands as Command[];
      assertDraftSafeBatch(commands);
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

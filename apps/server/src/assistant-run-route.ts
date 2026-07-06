import {
  CREDENTIAL_COMMAND_ARG_FIELDS,
  createAssistantRun,
  getOAuthToken,
  resolveDefaultAnthropicModel,
  type AssistantRunTerminationReason,
  type CreateAssistantRunOptions,
} from "@dashframe/assistant";
import type { WyStackApp } from "@wystack/server";
import type { Context } from "hono";

import { createDashframeAssistantHost } from "./assistant-host";
import type { DraftController } from "./draft-controller";

export type AssistantSidebarEvent =
  | { type: "run-start" }
  | { type: "text-delta"; delta: string }
  | { type: "assistant-message"; text: string; stopReason?: string }
  | {
      type: "command-start";
      toolCallId: string;
      commandType: string;
      args: unknown;
    }
  | {
      type: "command-end";
      toolCallId: string;
      commandType: string;
      isError: boolean;
      result: unknown;
    }
  | { type: "tool-start"; toolCallId: string; toolName: string }
  | {
      type: "tool-end";
      toolCallId: string;
      toolName: string;
      isError: boolean;
    }
  | { type: "first-mutation"; draftId: string }
  | {
      type: "run-end";
      draftId: string;
      firstMutationObserved: boolean;
      terminationReason: AssistantRunTerminationReason;
    }
  | { type: "error"; message: string };

interface AssistantRunRouteOptions {
  app: WyStackApp;
  draftController: DraftController;
  resolveContext?: (req: Request) => Promise<Record<string, unknown>>;
}

interface AssistantRunRequestBody {
  prompt?: unknown;
  artifact?: unknown;
  provider?: unknown;
  modelId?: unknown;
}

type AgentEvent = Parameters<
  NonNullable<CreateAssistantRunOptions["onEvent"]>
>[0];
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textFromMessage(
  message: Extract<AgentEvent, { type: "message_end" }>["message"],
): string {
  if (!("content" in message) || !Array.isArray(message.content)) return "";
  return message.content
    .flatMap((block) =>
      block.type === "text" && block.text.trim() ? [block.text] : [],
    )
    .join("\n");
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      shouldRedactKey(key) ? "[redacted]" : redact(child),
    ]),
  );
}

function shouldRedactKey(key: string): boolean {
  if (
    Object.values(CREDENTIAL_COMMAND_ARG_FIELDS).some((fields) =>
      fields.includes(key as "apiKey" | "connectionString"),
    )
  ) {
    return true;
  }
  return /password|secret|token/i.test(key);
}

function commandTypeFromArgs(args: unknown): string {
  if (args && typeof args === "object") {
    const value = (args as { type?: unknown }).type;
    if (typeof value === "string" && value.trim()) return value;
  }
  return "applyCommand";
}

function commandArgsFromArgs(args: unknown): unknown {
  if (args && typeof args === "object" && "args" in args) {
    return redact((args as { args?: unknown }).args ?? null);
  }
  return null;
}

function messageEventFromAgentEvent(
  event: Extract<AgentEvent, { type: "message_end" }>,
): AssistantSidebarEvent[] {
  if (event.message.role !== "assistant") return [];
  const text = textFromMessage(event.message);
  if (!text) return [];
  return [
    {
      type: "assistant-message",
      text,
      stopReason: event.message.stopReason,
    },
  ];
}

function toolStartEventFromAgentEvent(
  event: Extract<AgentEvent, { type: "tool_execution_start" }>,
): AssistantSidebarEvent {
  if (event.toolName === "applyCommand") {
    return {
      type: "command-start",
      toolCallId: event.toolCallId,
      commandType: commandTypeFromArgs(event.args),
      args: commandArgsFromArgs(event.args),
    };
  }
  return {
    type: "tool-start",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
  };
}

function commandResultType(result: unknown): string {
  if (!result || typeof result !== "object") return "applyCommand";
  return String(
    (result as { commandType?: unknown }).commandType ?? "applyCommand",
  );
}

function toolEndEventFromAgentEvent(
  event: Extract<AgentEvent, { type: "tool_execution_end" }>,
): AssistantSidebarEvent {
  if (event.toolName === "applyCommand") {
    const result =
      event.result && typeof event.result === "object"
        ? (event.result as { details?: unknown }).details
        : null;
    return {
      type: "command-end",
      toolCallId: event.toolCallId,
      commandType: commandResultType(result),
      isError: event.isError,
      result: redact(result),
    };
  }
  return {
    type: "tool-end",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    isError: event.isError,
  };
}

function sidebarEventsFromAgentEvent(
  event: AgentEvent,
): AssistantSidebarEvent[] {
  switch (event.type) {
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        return [{ type: "text-delta", delta: update.delta }];
      }
      return [];
    }
    case "message_end":
      return messageEventFromAgentEvent(event);
    case "tool_execution_start":
      return [toolStartEventFromAgentEvent(event)];
    case "tool_execution_end":
      return [toolEndEventFromAgentEvent(event)];
    default:
      return [];
  }
}

async function getScopedApiKey(provider: string): Promise<string | undefined> {
  if (provider !== "anthropic") return undefined;
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.ANTHROPIC_OAUTH_TOKEN?.trim()) {
    return process.env.ANTHROPIC_OAUTH_TOKEN;
  }
  return getOAuthToken();
}

function encodeSse(event: AssistantSidebarEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function readBody(c: Context): Promise<AssistantRunRequestBody> {
  const raw = await c.req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as AssistantRunRequestBody;
  return parsed;
}

export async function handleAssistantRunRequest(
  c: Context,
  options: AssistantRunRouteOptions,
): Promise<Response> {
  try {
    await options.resolveContext?.(c.req.raw);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 401);
  }

  let body: AssistantRunRequestBody;
  try {
    body = await readBody(c);
  } catch {
    return c.json({ error: "Invalid JSON in request body" }, 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return c.json({ error: "Assistant prompt is required" }, 400);
  }

  const model = resolveDefaultAnthropicModel(
    typeof body.modelId === "string" ? body.modelId : undefined,
  );
  const host = createDashframeAssistantHost({
    app: options.app,
    draftController: options.draftController,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: AssistantSidebarEvent) => {
        controller.enqueue(encoder.encode(encodeSse(event)));
      };

      send({ type: "run-start" });
      try {
        const result = await createAssistantRun(host, {
          model,
          prompt,
          context:
            body.artifact && typeof body.artifact === "object"
              ? { artifact: body.artifact }
              : undefined,
          getApiKey: getScopedApiKey,
          onFirstMutation: ({ draftId }) => {
            send({ type: "first-mutation", draftId });
          },
          onEvent: (event) => {
            for (const sidebarEvent of sidebarEventsFromAgentEvent(event)) {
              send(sidebarEvent);
            }
          },
        });
        send({
          type: "run-end",
          draftId: result.draftId,
          firstMutationObserved: result.firstMutationObserved,
          terminationReason: result.terminationReason,
        });
      } catch (error) {
        send({ type: "error", message: errorMessage(error) });
      } finally {
        controller.close();
      }
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

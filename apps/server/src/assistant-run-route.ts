import {
  CREDENTIAL_COMMAND_ARG_FIELDS,
  createAssistantRun,
  getOAuthToken,
  resolveDefaultAnthropicModel,
  type AssistantRunTerminationReason,
  type CreateAssistantRunOptions,
} from "@dashframe/assistant";
import type { HostMetadata, AssistantProviderConfigRow } from "./host/metadata";
import { isPrincipal } from "@wystack/identity";
import type { SecretVault } from "@wystack/secret-vault";
import type { ApplicationOperations } from "./host/application";
import type { Context } from "hono";

import { createDashframeAssistantHost } from "./assistant-host";
import { resolveAssistantProviderConfigForRun } from "./host/assistant-providers";

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
  app: ApplicationOperations;
  metadata: HostMetadata;
  vault?: SecretVault;
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

function requestedText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function selectAssistantProviderConfigForRun(args: {
  metadata: HostMetadata;
  provider?: string;
  modelId?: string;
}): Promise<AssistantProviderConfigRow | undefined> {
  const rows = await args.metadata.listAssistantProviderConfigs();
  if (rows.length === 0) {
    if (args.provider) {
      throw new Error(
        `Assistant provider/config ${args.provider} was not found`,
      );
    }
    return undefined;
  }

  const selected = args.provider
    ? rows.find(
        (row) => row.id === args.provider || row.providerId === args.provider,
      )
    : (rows.find((row) => row.isDefault) ??
      rows.find((row) => row.providerId === "anthropic") ??
      rows[0]);
  if (!selected) {
    throw new Error(`Assistant provider/config ${args.provider} was not found`);
  }
  return args.modelId ? { ...selected, defaultModel: args.modelId } : selected;
}

async function resolveRunProvider(args: {
  body: AssistantRunRequestBody;
  metadata: HostMetadata;
  vault?: SecretVault;
}): Promise<{
  model: ReturnType<typeof resolveDefaultAnthropicModel>;
  getApiKey: CreateAssistantRunOptions["getApiKey"];
}> {
  const provider = requestedText(args.body.provider);
  const modelId = requestedText(args.body.modelId);
  const row = await selectAssistantProviderConfigForRun({
    metadata: args.metadata,
    provider,
    modelId,
  });

  if (!row) {
    const model = resolveDefaultAnthropicModel(modelId);
    return { model, getApiKey: getScopedApiKey };
  }

  const resolved = await resolveAssistantProviderConfigForRun({
    row,
    vault: args.vault,
    updateCredentialRef: async (ref) => {
      await args.metadata.saveAssistantProviderConfig({
        row: { ...row, credentialRef: ref, updatedAt: Date.now() },
        expected: row,
      });
    },
  });
  const apiKey = (resolved.options as { apiKey?: string }).apiKey;
  return {
    model: resolved.model as ReturnType<typeof resolveDefaultAnthropicModel>,
    getApiKey: (requestedProvider) =>
      requestedProvider === resolved.model.provider ? apiKey : undefined,
  };
}

function encodeSse(event: AssistantSidebarEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function readBody(c: Context): Promise<AssistantRunRequestBody> {
  const raw = await c.req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  // JSON.parse accepts non-object payloads ("null", "42", "[]"); a null body
  // would otherwise escape the caller's catch and throw at `body.prompt`.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as AssistantRunRequestBody;
}

export async function handleAssistantRunRequest(
  c: Context,
  options: AssistantRunRouteOptions,
): Promise<Response> {
  let resolved: Record<string, unknown> | undefined;
  try {
    resolved = await options.resolveContext?.(c.req.raw);
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

  let runProvider: Awaited<ReturnType<typeof resolveRunProvider>>;
  try {
    runProvider = await resolveRunProvider({
      body,
      metadata: options.metadata,
      vault: options.vault,
    });
  } catch (err) {
    // Unknown requested model id is a client error; a failure to resolve
    // the default list is a server configuration fault — let it propagate.
    if (typeof body.modelId === "string" || typeof body.provider === "string") {
      return c.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Unknown assistant provider or model",
        },
        400,
      );
    }
    throw err;
  }
  const host = createDashframeAssistantHost({
    app: options.app,
    principal: isPrincipal(resolved?.principal)
      ? resolved.principal
      : undefined,
  });

  // Abort the provider run when the client goes away — either the fetch is
  // aborted (request signal) or the SSE stream consumer cancels. Without this
  // the run keeps spending provider tokens and mutating the draft after the
  // user has navigated away.
  const runAbort = new AbortController();
  const requestSignal = c.req.raw.signal;
  if (requestSignal.aborted) {
    runAbort.abort();
  } else {
    requestSignal.addEventListener("abort", () => runAbort.abort(), {
      once: true,
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: AssistantSidebarEvent) => {
        // The consumer may have cancelled mid-run; enqueue on a closed
        // stream throws and would mask the run's own termination path.
        if (runAbort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          runAbort.abort();
        }
      };

      send({ type: "run-start" });
      try {
        const result = await createAssistantRun(host, {
          model: runProvider.model,
          prompt,
          context:
            body.artifact && typeof body.artifact === "object"
              ? { artifact: body.artifact }
              : undefined,
          getApiKey: runProvider.getApiKey,
          signal: runAbort.signal,
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
        console.error("[assistant/run] run failed", error);
        send({
          type: "error",
          message: "The assistant couldn't complete this request. Try again.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by consumer cancellation.
        }
      }
    },
    cancel() {
      runAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

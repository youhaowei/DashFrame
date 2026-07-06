import {
  runAgentLoop,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolCall,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Message,
  Model,
} from "@earendil-works/pi-ai";
import { createHash } from "node:crypto";

import { createApplyCommandTool } from "./apply-command-tool.js";
import type { AssistantHost } from "./assistant-host.js";
import { createReadTools } from "./read/tools.js";

export type AssistantRunPrompt = string | AgentMessage | AgentMessage[];

export interface CreateAssistantRunOptions {
  model: Model<Api>;
  prompt: AssistantRunPrompt;
  systemPrompt?: string;
  streamFn?: StreamFn;
  getApiKey?: (
    provider: string,
  ) => Promise<string | undefined> | string | undefined;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => Promise<void> | void;
  onFirstMutation?: (event: { draftId: string }) => Promise<void> | void;
  maxConsecutiveFailures?: number;
}

export type AssistantRunTerminationReason =
  | "completed"
  | "aborted"
  | "error"
  | "failureCap"
  | "oscillation";

export interface AssistantRunResult {
  draftId: string;
  messages: AgentMessage[];
  firstMutationObserved: boolean;
  terminationReason: AssistantRunTerminationReason;
  discard(): Promise<void>;
}

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;

const DEFAULT_SYSTEM_PROMPT =
  "You are the DashFrame authoring assistant. Use the provided read tools to " +
  "understand the project graph and applyCommand for all mutations. Write only " +
  "to the draft sandbox; publishing is a human action.";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
} as const;

function passThroughMessages(messages: AgentMessage[]): Message[] {
  return messages.flatMap((message) => {
    if (
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult"
    ) {
      return [message];
    }
    return [];
  });
}

function normalizePrompt(prompt: AssistantRunPrompt): AgentMessage[] {
  if (typeof prompt === "string") {
    return [
      {
        role: "user",
        content: [{ type: "text", text: prompt }],
        timestamp: Date.now(),
      },
    ];
  }
  if (Array.isArray(prompt)) return prompt;
  return [prompt];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function fingerprintApplyCommand(args: unknown): string {
  const params = args as { type?: unknown; args?: unknown };
  const batch = [
    {
      type: params.type ?? null,
      args: canonicalize(params.args ?? null),
    },
  ];
  return createHash("sha256").update(JSON.stringify(batch)).digest("hex");
}

function normalizeMaxConsecutiveFailures(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CONSECUTIVE_FAILURES;
  if (!Number.isFinite(value)) return DEFAULT_MAX_CONSECUTIVE_FAILURES;
  return Math.max(1, Math.floor(value));
}

function createRecoveryGuard(maxConsecutiveFailures: number) {
  let consecutiveFailures = 0;
  const failedFingerprints = new Set<string>();
  const finalizedToolCallIds = new Set<string>();
  let terminationReason: AssistantRunTerminationReason = "completed";

  return {
    get terminationReason() {
      return terminationReason;
    },
    get shouldBlockApplyCommand() {
      return terminationReason !== "completed";
    },
    observeApplyCommandResult(options: {
      toolCall: AgentToolCall;
      args: unknown;
      isError: boolean;
      source: "afterToolCall" | "messageEnd";
    }) {
      if (options.toolCall.name !== "applyCommand") {
        return terminationReason;
      }
      if (
        options.source === "messageEnd" &&
        finalizedToolCallIds.delete(options.toolCall.id)
      ) {
        return terminationReason;
      }
      if (options.source === "afterToolCall") {
        finalizedToolCallIds.add(options.toolCall.id);
      }
      if (terminationReason !== "completed") {
        return terminationReason;
      }

      if (!options.isError) {
        consecutiveFailures = 0;
        failedFingerprints.clear();
        return terminationReason;
      }

      consecutiveFailures += 1;
      const fingerprint = fingerprintApplyCommand(options.args);
      if (failedFingerprints.has(fingerprint)) {
        terminationReason = "oscillation";
        return terminationReason;
      }
      failedFingerprints.add(fingerprint);

      if (consecutiveFailures >= maxConsecutiveFailures) {
        terminationReason = "failureCap";
      }
      return terminationReason;
    },
  };
}

async function discardIfUnsurfaced(options: {
  host: AssistantHost;
  draftId: string;
  wasSurfaced: () => boolean;
}): Promise<void> {
  // An unmutated draft was never surfaced (onFirstMutation did not fire), so
  // nothing references it — discard it best-effort. A mutated draft is
  // already surfaced with its draftId via onFirstMutation; the host owns its
  // disposition.
  if (options.wasSurfaced()) return;
  try {
    await options.host.discard(options.draftId);
  } catch {
    // Best-effort cleanup — the caller's failure/cancellation is the signal.
  }
}

async function promptWithDraftCleanup(options: {
  run: () => Promise<void>;
  host: AssistantHost;
  draftId: string;
  wasSurfaced: () => boolean;
}): Promise<void> {
  try {
    await options.run();
  } catch (error) {
    // pi resolves provider failures into stopReason:"error" messages, so a
    // rejection here is exceptional (setup/internal). It must still not
    // orphan the sandbox.
    await discardIfUnsurfaced(options);
    throw error;
  }
}

function createFailureMessage(options: {
  model: Model<Api>;
  error: unknown;
  aborted: boolean;
}): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: options.model.api,
    provider: options.model.provider,
    model: options.model.id,
    usage: EMPTY_USAGE,
    stopReason: options.aborted ? "aborted" : "error",
    errorMessage:
      options.error instanceof Error
        ? options.error.message
        : String(options.error),
    timestamp: Date.now(),
  };
}

async function emitFailure(options: {
  message: AssistantMessage;
  emit: (event: AgentEvent) => Promise<void>;
}): Promise<void> {
  await options.emit({ type: "message_start", message: options.message });
  await options.emit({ type: "message_end", message: options.message });
  await options.emit({
    type: "turn_end",
    message: options.message,
    toolResults: [],
  });
  await options.emit({ type: "agent_end", messages: [options.message] });
}

function createTools(options: {
  host: AssistantHost;
  draftId: string;
  context?: Record<string, unknown>;
  markFirstMutation: () => Promise<void>;
  shouldExecuteApplyCommand: () => boolean;
}): AgentTool[] {
  const readTools = Object.values(
    createReadTools(options.host.reader(options.draftId)),
  );
  const applyCommand = createApplyCommandTool({
    host: options.host,
    draftId: options.draftId,
    context: options.context,
    onSuccess: options.markFirstMutation,
    shouldExecute: options.shouldExecuteApplyCommand,
  });
  return [...readTools, applyCommand];
}

export async function createAssistantRun(
  host: AssistantHost,
  options: CreateAssistantRunOptions,
): Promise<AssistantRunResult> {
  const draftId = await host.open();
  let firstMutationObserved = false;
  const messages: AgentMessage[] = [];
  const applyCommandCalls = new Map<string, AgentToolCall>();
  let runTerminationReason: AssistantRunTerminationReason | undefined;
  const recoveryGuard = createRecoveryGuard(
    normalizeMaxConsecutiveFailures(options.maxConsecutiveFailures),
  );

  async function markFirstMutation() {
    if (firstMutationObserved) return;
    firstMutationObserved = true;
    try {
      await options.onFirstMutation?.({ draftId });
    } catch {
      // The first-mutation signal is advisory (UI surfacing). An observer
      // failure must not fail the applyCommand tool call — the append has
      // already persisted, and a false tool error would invite a retry.
    }
  }

  const tools = createTools({
    host,
    draftId,
    context: options.context,
    markFirstMutation,
    // pi's afterToolCall terminate hint is evaluated only after the current
    // tool batch, so a same-turn second applyCommand may still be prepared.
    // Refusing inside the tool blocks further draft mutations for this run;
    // other non-mutating or invalid tool results may still finish the turn.
    shouldExecuteApplyCommand: () => !recoveryGuard.shouldBlockApplyCommand,
  });

  async function emit(event: AgentEvent) {
    if (
      event.type === "tool_execution_start" &&
      event.toolName === "applyCommand"
    ) {
      applyCommandCalls.set(event.toolCallId, {
        type: "toolCall",
        id: event.toolCallId,
        name: event.toolName,
        arguments: event.args,
      });
    }
    if (event.type === "message_end") {
      messages.push(event.message);
      if (
        event.message.role === "assistant" &&
        event.message.stopReason === "aborted"
      ) {
        runTerminationReason ??= "aborted";
      } else if (
        event.message.role === "assistant" &&
        event.message.stopReason === "error"
      ) {
        runTerminationReason ??= "error";
      } else if (
        event.message.role === "toolResult" &&
        event.message.toolName === "applyCommand"
      ) {
        const toolCall =
          applyCommandCalls.get(event.message.toolCallId) ??
          ({
            type: "toolCall",
            id: event.message.toolCallId,
            name: event.message.toolName,
            arguments: {},
          } satisfies AgentToolCall);
        recoveryGuard.observeApplyCommandResult({
          toolCall,
          args: toolCall.arguments,
          isError: event.message.isError,
          source: "messageEnd",
        });
      }
    }
    await options.onEvent?.(event);
  }

  if (options.signal?.aborted) {
    // Cancelled before the run started: nothing to prompt; clean up the
    // just-minted sandbox if it never surfaced.
    runTerminationReason = "aborted";
    await discardIfUnsurfaced({
      host,
      draftId,
      wasSurfaced: () => firstMutationObserved,
    });
  } else {
    await promptWithDraftCleanup({
      host,
      draftId,
      wasSurfaced: () => firstMutationObserved,
      run: async () => {
        try {
          await runAgentLoop(
            normalizePrompt(options.prompt),
            {
              systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
              messages: [],
              tools,
            },
            {
              model: options.model,
              convertToLlm: passThroughMessages,
              getApiKey: options.getApiKey,
              toolExecution: "sequential",
              afterToolCall: async ({ toolCall, args, isError }) => {
                const reason = recoveryGuard.observeApplyCommandResult({
                  toolCall,
                  args,
                  isError,
                  source: "afterToolCall",
                });
                return reason === "completed" ? undefined : { terminate: true };
              },
              shouldStopAfterTurn: () =>
                recoveryGuard.terminationReason !== "completed",
            },
            emit,
            options.signal,
            options.streamFn,
          );
        } catch (error) {
          runTerminationReason =
            options.signal?.aborted === true ? "aborted" : "error";
          await emitFailure({
            message: createFailureMessage({
              model: options.model,
              error,
              aborted: options.signal?.aborted === true,
            }),
            emit,
          });
        }
      },
    });
  }

  return {
    draftId,
    messages,
    firstMutationObserved,
    terminationReason: runTerminationReason ?? recoveryGuard.terminationReason,
    discard: () => host.discard(draftId),
  };
}

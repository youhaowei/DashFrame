import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Api, Message, Model } from "@earendil-works/pi-ai";

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
}

export interface AssistantRunResult {
  draftId: string;
  messages: AgentMessage[];
  firstMutationObserved: boolean;
  discard(): Promise<void>;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are the DashFrame authoring assistant. Use the provided read tools to " +
  "understand the project graph and applyCommand for all mutations. Write only " +
  "to the draft sandbox; publishing is a human action.";

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

function promptAgent(agent: Agent, prompt: AssistantRunPrompt): Promise<void> {
  // The calls look identical, but agent.prompt is overloaded on (string) vs
  // (AgentMessage | AgentMessage[]) — the typeof narrowing is what lets each
  // call match one overload.
  if (typeof prompt === "string") return agent.prompt(prompt);
  return agent.prompt(prompt);
}

async function promptWithDraftCleanup(options: {
  agent: Agent;
  prompt: AssistantRunPrompt;
  host: AssistantHost;
  draftId: string;
  wasSurfaced: () => boolean;
}): Promise<void> {
  try {
    await promptAgent(options.agent, options.prompt);
  } catch (error) {
    // pi resolves provider failures into stopReason:"error" messages, so a
    // rejection here is exceptional (setup/internal). It must still not
    // orphan the sandbox.
    await discardIfUnsurfaced(options);
    throw error;
  }
}

function createTools(options: {
  host: AssistantHost;
  draftId: string;
  context?: Record<string, unknown>;
  markFirstMutation: () => Promise<void>;
}): AgentTool[] {
  const readTools = Object.values(
    createReadTools(options.host.reader(options.draftId)),
  );
  const applyCommand = createApplyCommandTool({
    host: options.host,
    draftId: options.draftId,
    context: options.context,
    onSuccess: options.markFirstMutation,
  });
  return [...readTools, applyCommand];
}

export async function createAssistantRun(
  host: AssistantHost,
  options: CreateAssistantRunOptions,
): Promise<AssistantRunResult> {
  const draftId = await host.open();
  let firstMutationObserved = false;

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

  const agent = new Agent({
    initialState: {
      model: options.model,
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      tools: createTools({
        host,
        draftId,
        context: options.context,
        markFirstMutation,
      }),
    },
    convertToLlm: passThroughMessages,
    streamFn: options.streamFn,
    getApiKey: options.getApiKey,
    toolExecution: "sequential",
  });

  if (options.onEvent !== undefined) {
    agent.subscribe((event) => options.onEvent?.(event));
  }

  let onAbort: (() => void) | undefined;
  if (options.signal !== undefined && !options.signal.aborted) {
    onAbort = () => agent.abort();
    options.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    if (options.signal?.aborted) {
      // Cancelled before the run started: nothing to prompt; clean up the
      // just-minted sandbox if it never surfaced.
      await discardIfUnsurfaced({
        host,
        draftId,
        wasSurfaced: () => firstMutationObserved,
      });
    } else {
      await promptWithDraftCleanup({
        agent,
        prompt: options.prompt,
        host,
        draftId,
        wasSurfaced: () => firstMutationObserved,
      });
    }
  } finally {
    if (onAbort !== undefined && options.signal !== undefined) {
      options.signal.removeEventListener("abort", onAbort);
    }
  }

  return {
    draftId,
    messages: agent.state.messages,
    firstMutationObserved,
    discard: () => host.discard(draftId),
  };
}

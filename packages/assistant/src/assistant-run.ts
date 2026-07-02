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

export interface CreateAssistantRunOptions {
  model: Model<Api>;
  prompt: string | AgentMessage | AgentMessage[];
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

function promptAgent(
  agent: Agent,
  prompt: string | AgentMessage | AgentMessage[],
): Promise<void> {
  if (typeof prompt === "string") return agent.prompt(prompt);
  return agent.prompt(prompt);
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
    await options.onFirstMutation?.({ draftId });
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

  if (options.signal !== undefined) {
    if (options.signal.aborted) agent.abort();
    else
      options.signal.addEventListener("abort", () => agent.abort(), {
        once: true,
      });
  }

  await promptAgent(agent, options.prompt);

  return {
    draftId,
    messages: agent.state.messages,
    firstMutationObserved,
    discard: () => host.discard(draftId),
  };
}

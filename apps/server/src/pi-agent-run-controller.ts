/**
 * pi-agent run controller — DashFrame host glue around pi's real agent loop.
 *
 * Owns the draft sandbox lifecycle and tool assembly. It does not publish:
 * a completed run returns a draft handle for the human publish/discard surface.
 */

import {
  createApplyCommandTool,
  createReadTools,
  type AssistantCommand,
} from "@dashframe/assistant";
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type { WyStackApp } from "@wystack/server";

import { createAssistantReadHost } from "./assistant-read-host";
import type { DraftController } from "./draft-controller";
import {
  cmd,
  COMMAND_PATHS,
  type CommandName,
  type CommandPayloads,
} from "./functions/commands";

export interface PiAgentRunControllerOptions {
  app: WyStackApp;
  draftController: DraftController;
  model: Model<Api>;
  systemPrompt?: string;
  streamFn?: StreamFn;
  getApiKey?: (
    provider: string,
  ) => Promise<string | undefined> | string | undefined;
  readSourceFile?: (file: string) => Promise<string>;
  context?: Record<string, unknown>;
}

export interface StartPiAgentRunOptions {
  prompt: string | AgentMessage | AgentMessage[];
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => Promise<void> | void;
  onFirstMutation?: (event: { draftId: string }) => Promise<void> | void;
}

export interface PiAgentRunResult {
  draftId: string;
  messages: AgentMessage[];
  firstMutationObserved: boolean;
  discard(): Promise<void>;
}

export interface PiAgentRunController {
  start(options: StartPiAgentRunOptions): Promise<PiAgentRunResult>;
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

function buildCommand(type: string, args: unknown): AssistantCommand {
  if (!(type in COMMAND_PATHS)) {
    throw new Error(`Unknown command: "${type}"`);
  }
  return cmd(
    type as CommandName,
    args as CommandPayloads[CommandName],
  ) as AssistantCommand;
}

function createDraftAwareTools(options: {
  app: WyStackApp;
  draftController: DraftController;
  draftId: string;
  context?: Record<string, unknown>;
  readSourceFile?: (file: string) => Promise<string>;
  markFirstMutation: () => Promise<void>;
}): AgentTool[] {
  const reader = createAssistantReadHost({
    app: options.app,
    draftId: options.draftId,
    readSourceFile: options.readSourceFile,
  });
  const readTools = Object.values(createReadTools(reader));

  const applyCommand = createApplyCommandTool({
    controller: {
      appendToDraft: async (draftId, batch, context) => {
        const results = await options.draftController.appendToDraft(
          draftId,
          batch,
          context,
        );
        await options.markFirstMutation();
        return results;
      },
    },
    draftId: options.draftId,
    buildCommand,
    context: options.context,
  });

  return [...readTools, applyCommand];
}

export function createPiAgentRunController(
  options: PiAgentRunControllerOptions,
): PiAgentRunController {
  return {
    async start(runOptions) {
      const draftId = await options.draftController.openDraft();
      let firstMutationObserved = false;

      async function markFirstMutation() {
        if (firstMutationObserved) return;
        firstMutationObserved = true;
        await runOptions.onFirstMutation?.({ draftId });
      }

      const agent = new Agent({
        initialState: {
          model: options.model,
          systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          tools: createDraftAwareTools({
            app: options.app,
            draftController: options.draftController,
            draftId,
            context: options.context,
            readSourceFile: options.readSourceFile,
            markFirstMutation,
          }),
        },
        convertToLlm: passThroughMessages,
        streamFn: options.streamFn,
        getApiKey: options.getApiKey,
        toolExecution: "sequential",
      });

      if (runOptions.onEvent !== undefined) {
        agent.subscribe((event) => runOptions.onEvent?.(event));
      }

      if (runOptions.signal !== undefined) {
        if (runOptions.signal.aborted) agent.abort();
        else
          runOptions.signal.addEventListener("abort", () => agent.abort(), {
            once: true,
          });
      }

      await promptAgent(agent, runOptions.prompt);

      return {
        draftId,
        messages: agent.state.messages,
        firstMutationObserved,
        discard: () => options.draftController.discardDraft(draftId),
      };
    },
  };
}

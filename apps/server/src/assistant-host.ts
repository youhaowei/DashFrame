import type {
  AssistantCommand,
  AssistantCommandResult,
  AssistantHost,
} from "@dashframe/assistant";
import type { Principal } from "@wystack/identity";
import type { ApplicationOperations } from "./host/application";

import { createAssistantReadHost } from "./assistant-read-host";
import {
  cmd,
  COMMAND_PATHS,
  type CommandName,
  type CommandPayloads,
} from "@dashframe/types";

export interface DashframeAssistantHostOptions {
  /** Verified host application dispatch; draft ownership is enforced in Convex. */
  app: ApplicationOperations;
  principal?: Principal;
  readSourceFile?: (file: string) => Promise<string>;
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

export function createDashframeAssistantHost(
  options: DashframeAssistantHostOptions,
): AssistantHost {
  return {
    open: async () => {
      const result = await options.app.execute(
        "draftBatch",
        { commands: [] },
        { principal: options.principal },
      );
      return (result as { draftId: string }).draftId;
    },
    append: async (draftId, batch) => {
      const result = await options.app.execute(
        "draftBatch",
        { draftId, commands: batch },
        { principal: options.principal },
      );
      return (result as { results: AssistantCommandResult[] }).results;
    },
    discard: async (draftId) => {
      await options.app.execute(
        "discardDraft",
        { draftId },
        { principal: options.principal },
      );
    },
    buildCommand,
    reader: (draftId) =>
      createAssistantReadHost({
        app: options.principal
          ? options.app.forPrincipal(options.principal)
          : options.app,
        draftId,
        readSourceFile: options.readSourceFile,
      }),
  };
}

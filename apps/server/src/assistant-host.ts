import type { AssistantCommand, AssistantHost } from "@dashframe/assistant";
import type { WyStackApp } from "@wystack/server";

import { createAssistantReadHost } from "./assistant-read-host";
import type { DraftController } from "./draft-controller";
import {
  cmd,
  COMMAND_PATHS,
  type CommandName,
  type CommandPayloads,
} from "./functions/commands";

export interface DashframeAssistantHostOptions {
  app: WyStackApp;
  draftController: DraftController;
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
    open: () => options.draftController.openDraft(),
    append: (draftId, batch, context) =>
      options.draftController.appendToDraft(draftId, batch, context),
    discard: (draftId) => options.app.call("discardDraft", { draftId }),
    buildCommand,
    reader: (draftId) =>
      createAssistantReadHost({
        app: options.app,
        draftId,
        readSourceFile: options.readSourceFile,
      }),
  };
}

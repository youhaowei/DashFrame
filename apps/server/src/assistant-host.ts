import type {
  AssistantCommand,
  AssistantCommandResult,
  AssistantHost,
} from "@dashframe/assistant";
import type { Principal } from "@wystack/identity";
import type { WyStackApp } from "@wystack/server";

import { principalKey } from "./app-context";
import { createAssistantReadHost } from "./assistant-read-host";
import type { DraftController } from "./draft-controller";
import {
  cmd,
  COMMAND_PATHS,
  type CommandName,
  type CommandPayloads,
} from "./functions/commands";

export interface DashframeAssistantHostOptions {
  /**
   * Must be the serverContext-wrapped app (createDashframeServer's `app`, or
   * a test equivalent): append/discard route through the registered draft RPCs,
   * whose handlers require `ctx.draftController` in every call context.
   */
  app: WyStackApp;
  draftController: DraftController;
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
    open: () =>
      options.draftController.openDraft(
        undefined,
        principalKey(options.principal) ?? undefined,
      ),
    append: async (draftId, batch, context) => {
      // Route through the operated draft mutation RPC. Besides authorization and
      // command validation, this is the seam that relays a rejected batch's
      // durable-prefix metadata to onWrite and subscription invalidation before
      // preserving the original handler error.
      const { result } = await options.app.call(
        "draftBatch",
        { draftId, commands: batch },
        {
          ...context,
          ...(options.principal !== undefined
            ? { principal: options.principal }
            : {}),
        },
      );
      return (result as { results: AssistantCommandResult[] }).results;
    },
    discard: async (draftId) => {
      // Route through the registered command so discard runs the full
      // lifecycle (credential release, persistence scheduling), not just the
      // controller's in-memory drop.
      await options.app.call(
        "discardDraft",
        { draftId },
        {
          ...(options.principal !== undefined
            ? { principal: options.principal }
            : {}),
        },
      );
    },
    buildCommand,
    reader: (draftId) =>
      createAssistantReadHost({
        app: options.app,
        draftId,
        readSourceFile: options.readSourceFile,
      }),
  };
}

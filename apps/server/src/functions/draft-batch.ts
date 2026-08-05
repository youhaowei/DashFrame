import { jsonb, text } from "@wystack/db";
import type { Command } from "@wystack/server";

import type { DashframeFunctionContext } from "../app-context";
import type { DraftController } from "../draft-controller";
import { permissions } from "../permissions";
import { wy } from "../wystack";
import { assertKnownCommandPaths } from "./commands";

const appendTails = new Map<string, Promise<void>>();

/**
 * DraftController.appendToDraft is single-writer per draftId. Every caller must
 * serialize. This RPC owns an in-process promise chain per durable draft handle
 * so concurrent API appends cannot race read/compact/replace-all sequence
 * allocation. A multi-process host would need the equivalent shared lock.
 */
async function serializeAppend<T>(
  draftId: string,
  append: () => Promise<T>,
): Promise<T> {
  const prior = appendTails.get(draftId) ?? Promise.resolve();
  const current = prior.catch(() => {}).then(append);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  appendTails.set(draftId, tail);
  try {
    return await current;
  } finally {
    if (appendTails.get(draftId) === tail) appendTails.delete(draftId);
  }
}

function requireDraftController(
  ctx: DashframeFunctionContext,
): DraftController {
  const controller = ctx.draftController as DraftController | undefined;
  if (!controller) {
    throw new Error(
      "draftBatch: draftController not in handler context — ensure createDashframeServer injects it",
    );
  }
  return controller;
}

const draftBatch = wy.procedure
  .input({ commands: jsonb, draftId: text.optional() })
  .authorize(permissions.commands.draft)
  .mutation(async (ctx, { commands, draftId }) => {
    if (!Array.isArray(commands)) {
      throw new Error("draftBatch: commands must be an array");
    }
    assertKnownCommandPaths(commands as Command[], "draftBatch");

    const controller = requireDraftController(ctx);
    const targetDraftId = draftId ?? (await controller.openDraft());
    const context: Record<string, unknown> = {};
    if (ctx.principal !== undefined) context.principal = ctx.principal;
    if (ctx.vault !== undefined) context.vault = ctx.vault;
    const results = await serializeAppend(targetDraftId, () =>
      controller.appendToDraft(targetDraftId, commands as Command[], context),
    );

    return {
      draftId: targetDraftId,
      results,
      __extraTablesWritten: ["draft_command_log"],
    };
  });

export const draftBatchFunctions = { draftBatch };

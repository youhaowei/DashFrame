import { jsonb, text } from "@wystack/db";
import type { Command } from "@wystack/server";

import type { DashframeFunctionContext } from "../app-context";
import {
  DRAFT_COMMAND_LOG_TABLE,
  type DraftController,
} from "../draft-controller";
import { permissions } from "../permissions";
import { wy } from "../wystack";
import { assertKnownCommandPaths } from "./commands";

const appendTails = new Map<string, Promise<void>>();

/**
 * DraftController.appendToDraft is single-writer per draftId. Every caller must
 * serialize. This RPC owns an in-process promise chain per durable draft handle
 * so concurrent `draftBatch` appends cannot race read/compact/replace-all
 * sequence allocation.
 *
 * SCOPE — this chain covers append-vs-append THROUGH THIS RPC only. The other
 * writers on a draft handle (the assistant host's direct `appendToDraft`, and
 * `reviseDraft`'s replace-all) do not join it, so an append concurrent with
 * either of those is still unserialized. A multi-process host, or closing that
 * gap, needs a shared per-draft lock at the controller instead of here.
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
    // A caller-supplied handle must already be registered. The command log and
    // the shadow tables accept any id, so appending under an unknown draftId
    // would return 200 and write rows that `listDrafts` never surfaces and no
    // publish or discard can ever sweep — invisible, permanent orphans.
    if (draftId !== undefined && !(await controller.draftExists(draftId))) {
      throw new Error(`draftBatch: no open draft ${draftId}`);
    }
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
      __extraTablesWritten: [DRAFT_COMMAND_LOG_TABLE],
    };
  });

export const draftBatchFunctions = { draftBatch };

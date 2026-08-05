import { jsonb, text } from "@wystack/db";

import type { DashframeFunctionContext } from "../app-context";
import type { DraftController, DraftRevisionOp } from "../draft-controller";
import { permissions } from "../permissions";
import { wy } from "../wystack";

function requireDraftController(
  ctx: DashframeFunctionContext,
): DraftController {
  const controller = ctx.draftController as DraftController | undefined;
  if (!controller) {
    throw new Error(
      "reviseDraft: draftController not in handler context — ensure createDashframeServer injects it",
    );
  }
  return controller;
}

const reviseDraft = wy.procedure
  .input({ draftId: text, expectedLogSignature: text, ops: jsonb })
  .authorize(permissions.commands.commit)
  .mutation(async (ctx, { draftId, expectedLogSignature, ops }) => {
    if (!Array.isArray(ops)) {
      throw new Error("reviseDraft: ops must be an array");
    }
    const result = await requireDraftController(ctx).reviseDraft(
      draftId,
      expectedLogSignature,
      ops as DraftRevisionOp[],
    );
    return {
      ...result,
      __extraTablesWritten: ["draft_command_log"],
    };
  });

export const draftReviseFunctions = { reviseDraft };

import { jsonb, text } from "@wystack/db";
import type { Command, CommandResult } from "@wystack/server";

import { principalKey, type DashframeFunctionContext } from "../app-context";
import { DRAFT_UNAVAILABLE } from "../draft-access";
import {
  addRecoveredDraftWriteTables,
  DRAFT_COMMAND_LOG_TABLE,
  DraftLogStaleError,
  recoveredDraftWriteTables,
  type DraftController,
} from "../draft-controller";
import { permissions } from "../permissions";
import { wy } from "../wystack";
import { assertKnownCommandPaths } from "./commands";

const appendTails = new Map<string, Promise<void>>();

export interface DraftBatchError extends Error {
  draftId?: string;
}

export function draftIdFromBatchError(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const draftId = (error as DraftBatchError).draftId;
  return typeof draftId === "string" ? draftId : undefined;
}

/**
 * This RPC owns an in-process promise chain per durable draft handle so its
 * concurrent `draftBatch` appends avoid routine CAS stale-writer errors and
 * present a smoother caller experience.
 *
 * DraftController's CAS is the correctness mechanism for every caller,
 * including writers outside this in-process queue: it rejects stale log
 * snapshots instead of accepting a lost update.
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

async function rethrowFailedBatch(
  controller: DraftController,
  targetDraftId: string,
  openedHere: boolean,
  error: unknown,
): Promise<never> {
  const recoveredWrites = recoveredDraftWriteTables(error);
  // A rejected batch can still have an earlier, atomically logged prefix.
  // Add the log table to the controller's shadow-table metadata so the host
  // can invalidate and schedule persistence before rethrowing the same error.
  if (recoveredWrites.length > 0) {
    addRecoveredDraftWriteTables(error, [DRAFT_COMMAND_LOG_TABLE]);
    // Only a newly opened, already-owned handle is attached. This lets the
    // caller retain a durable successful prefix without exposing any
    // caller-supplied or foreign handle.
    if (openedHere && error instanceof Error) {
      (error as DraftBatchError).draftId = targetDraftId;
    }
  } else if (openedHere) {
    // A first-command failure has no durable work to recover. Remove only
    // the handle opened by this call; caller-carried handles are untouched.
    // Cleanup must not replace the command's original error.
    try {
      await controller.discardDraft(targetDraftId);
    } catch {
      // Preserve the original command failure for the caller.
    }
  }
  throw error;
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
    const ownerKey = principalKey(ctx.principal);
    if (ownerKey === null) throw new Error(DRAFT_UNAVAILABLE);
    // One predicate and one response for unknown, closed, and foreign handles.
    if (
      draftId !== undefined &&
      !(await controller.draftOwnedBy(draftId, ownerKey))
    ) {
      throw new Error(DRAFT_UNAVAILABLE);
    }
    const targetDraftId =
      draftId ?? (await controller.openDraft(undefined, ownerKey));
    const openedHere = draftId === undefined;
    const context: Record<string, unknown> = {};
    if (ctx.principal !== undefined) context.principal = ctx.principal;
    if (ctx.vault !== undefined) context.vault = ctx.vault;
    const results: CommandResult[] = await serializeAppend(
      targetDraftId,
      async () => {
        try {
          // The handle may close while this append waits behind another writer.
          if (!(await controller.draftOwnedBy(targetDraftId, ownerKey))) {
            throw new Error(DRAFT_UNAVAILABLE);
          }
          try {
            return await controller.appendToDraft(
              targetDraftId,
              commands as Command[],
              context,
            );
          } catch (error) {
            if (
              error instanceof DraftLogStaleError &&
              !(await controller.draftOwnedBy(targetDraftId, ownerKey))
            ) {
              throw new Error(DRAFT_UNAVAILABLE);
            }
            throw error;
          }
        } catch (error) {
          // Cleanup stays inside the serialized callback so a queued append
          // cannot commit between this failure and removal of an empty handle.
          return rethrowFailedBatch(
            controller,
            targetDraftId,
            openedHere,
            error,
          );
        }
      },
    );

    return {
      draftId: targetDraftId,
      results,
      __extraTablesWritten: [DRAFT_COMMAND_LOG_TABLE],
    };
  });

export const draftBatchFunctions = { draftBatch };

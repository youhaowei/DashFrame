/**
 * Draft lifecycle RPC endpoints — publishDraft, discardDraft, getDraftLog.
 *
 * These expose the DraftController's lifecycle operations as WyStack RPCs.
 * The DraftController instance is injected via handler context (see app.ts
 * `serverContext.draftController`).
 *
 * Invalidation note — SPLIT-TRACKER asymmetry:
 *   `publishDraft` replays the command log through `applyCommands` using its
 *   own fresh sub-tracker, so the outer `app.call` tracked context sees zero
 *   `tablesWritten`. To drive WS invalidation the handler returns
 *   `__extraTablesWritten` alongside its public result. The server app wrapper
 *   (`createDashframeServer` in app.ts) intercepts this field, merges the set
 *   into `callResult.tablesWritten`, then strips the field before forwarding the
 *   result to the client. The net effect: `createRoutes` sees a non-empty
 *   `tablesWritten` and fires `publishInvalidation` normally.
 *
 *   `onWrite` (snapshot persistence) is injected as `ctx.onWrite` and is called
 *   explicitly here — the outer `buildDashframeApp` wrapper does not fire it for
 *   the same sub-tracker reason.
 */
import { text } from "@wystack/db";
import type { Command } from "@wystack/server";
import { mutation, query } from "@wystack/server";

import type { DraftController } from "../draft-controller";

/**
 * Publish a draft: replay the durable command log onto canonical tables in one
 * atomic transaction, then delete the log + sweep shadow tables.
 *
 * Returns the set of canonical tables written so callers can correlate. The
 * server app wrapper also uses `__extraTablesWritten` (stripped before the
 * response reaches the client) to drive WS reactive invalidation.
 */
const publishDraft = mutation({
  args: { draftId: text },
  handler: async (
    ctx,
    { draftId },
  ): Promise<{ tablesWritten: string[] }> => {
    const draftController = ctx.draftController as DraftController | undefined;
    if (!draftController) {
      throw new Error(
        "publishDraft: draftController not in handler context — " +
          "ensure createDashframeServer injects it via serverContext",
      );
    }

    const result = await draftController.publishDraft(draftId, {});

    // Fire snapshot persistence. `buildDashframeApp`'s outer call wrapper does
    // NOT fire `onWrite` here (its tracker sees zero writes from the sub-tracker
    // used inside publishDraft). We call it explicitly via the injected callback.
    if (result.tablesWritten.size > 0) {
      const onWrite = ctx.onWrite as (() => void) | undefined;
      try {
        onWrite?.();
      } catch (err) {
        console.error("[dashframe] publishDraft: onWrite hook threw:", err);
      }
    }

    const tablesWritten = [...result.tablesWritten];
    return {
      tablesWritten,
      // Internal field consumed by the app.ts wrapper to drive WS invalidation.
      // Stripped from the response before it reaches the client.
      __extraTablesWritten: tablesWritten,
    } as { tablesWritten: string[] };
  },
});

/**
 * Discard a draft: delete the command log and sweep all draft shadow rows for
 * this draftId. Canonical tables are never touched.
 *
 * Fires `onWrite` (snapshot persistence) after a successful discard. The discard
 * deletes rows from the `draft_command_log` table and the six `<table>__draft`
 * shadows — all durable stores. If the process crashes before the next scheduled
 * snapshot, those rows would survive in the stale snapshot and resurrect the draft.
 * Triggering a snapshot after discard closes that window and prevents orphan rows.
 */
const discardDraft = mutation({
  args: { draftId: text },
  handler: async (ctx, { draftId }): Promise<void> => {
    const draftController = ctx.draftController as DraftController | undefined;
    if (!draftController) {
      throw new Error(
        "discardDraft: draftController not in handler context — " +
          "ensure createDashframeServer injects it via serverContext",
      );
    }

    await draftController.discardDraft(draftId);

    // Trigger snapshot persistence after discard — the shadow rows live in the
    // durable store; a stale snapshot would resurrect them on restart.
    const onWrite = ctx.onWrite as (() => void) | undefined;
    try {
      onWrite?.();
    } catch (err) {
      console.error("[dashframe] discardDraft: onWrite hook threw:", err);
    }
  },
});

/**
 * Read the compacted command log for a draft. Returns commands in replay order.
 * Used by the client to build the PreviewDiff before showing the review dialog.
 */
const getDraftLog = query({
  args: { draftId: text },
  handler: async (ctx, { draftId }): Promise<Command[]> => {
    const draftController = ctx.draftController as DraftController | undefined;
    if (!draftController) {
      throw new Error(
        "getDraftLog: draftController not in handler context — " +
          "ensure createDashframeServer injects it via serverContext",
      );
    }

    return draftController.getDraftLog(draftId);
  },
});

export const draftLifecycleFunctions = { publishDraft, discardDraft, getDraftLog };

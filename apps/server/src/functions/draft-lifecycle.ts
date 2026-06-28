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
import type { ArtifactDb } from "@dashframe/server-core";
import { text } from "@wystack/db";
import type { SecretVault } from "@wystack/secret-vault";
import type { Command } from "@wystack/server";
import { mutation, query } from "@wystack/server";

import {
  collectOldCanonicalRefs,
  extractDraftMintedRefs,
  releaseRefsAtTransition,
} from "../credential-release";
import type { DraftController } from "../draft-controller";
import { PUBLISH_REPLAY_CONTEXT_KEY } from "./utils";

/**
 * Internal-only return shape for `publishDraft`. The `__extraTablesWritten`
 * field is consumed by the `app.ts` wrapper (merges it into the WS
 * invalidation set, then strips it before forwarding to the client).
 * Declaring it here makes both the handler return and the interceptor in
 * `app.ts` type-checked against the same internal shape — TypeScript flags a
 * mismatch if either side diverges, rather than relying only on the
 * contract-3 test to catch leaks.
 */
interface PublishDraftInternalResult {
  tablesWritten: string[];
  __extraTablesWritten: string[];
}

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
  handler: async (ctx, { draftId }): Promise<PublishDraftInternalResult> => {
    const draftController = ctx.draftController as DraftController | undefined;
    if (!draftController) {
      throw new Error(
        "publishDraft: draftController not in handler context — " +
          "ensure createDashframeServer injects it via serverContext",
      );
    }

    // Pre-read the log length before publishing so we can determine whether
    // any durable rows were deleted, even when all commands are no-ops.
    // `publishDraft` unconditionally deletes the command log + shadow rows for
    // any non-empty draft (inside one atomic tx), so a draft with no-op
    // commands (e.g. GetOrCreateDataSource for an existing source) produces
    // `tablesWritten = {}` but still modifies durable storage. Without this
    // check, `onWrite` would be skipped and the deletion goes un-snapshotted,
    // leaving a resurrection window across server restarts.
    const prePublishLog = await draftController.getDraftLog(draftId);

    // TRANSITION-TIME RELEASE — publish half. Collect the canonical refs each
    // command will REPLACE *before* replay overwrites them; release runs only
    // AFTER the publish transaction commits (below), so a rolled-back publish
    // never deletes a still-live secret.
    const artifactDb = ctx.artifactDb as ArtifactDb | undefined;
    const vault = ctx.vault as SecretVault | undefined;
    const replacedRefs =
      artifactDb != null
        ? await collectOldCanonicalRefs(artifactDb, prePublishLog)
        : [];

    // Mark the replay as the sanctioned canonical-commit path so the credential
    // command handlers' direct-call guard accepts it (release is handled here).
    const result = await draftController.publishDraft(draftId, {
      [PUBLISH_REPLAY_CONTEXT_KEY]: true,
    });

    // Fire snapshot persistence. `buildDashframeApp`'s outer call wrapper does
    // NOT fire `onWrite` here (its tracker sees zero writes from the sub-tracker
    // used inside publishDraft). We call it explicitly via the injected callback.
    // Condition: fire when canonical tables were written OR when the draft had
    // a non-empty command log (its deletion is itself a durable change).
    if (result.tablesWritten.size > 0 || prePublishLog.length > 0) {
      const onWrite = ctx.onWrite as (() => void) | undefined;
      try {
        onWrite?.();
      } catch (err) {
        console.error("[dashframe] publishDraft: onWrite hook threw:", err);
      }
    }

    // Publish has committed: release the replaced canonical refs that are no
    // longer referenced by canonical or any other open draft (best-effort —
    // a release failure leaves an inert orphan, never fails the committed publish).
    if (artifactDb != null) {
      await releaseRefsAtTransition(artifactDb, vault, replacedRefs, draftId);
    }

    const tablesWritten = [...result.tablesWritten];
    return {
      tablesWritten,
      // Internal field consumed by the app.ts wrapper to drive WS invalidation.
      // Stripped from the response before it reaches the client.
      __extraTablesWritten: tablesWritten,
    };
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

    // TRANSITION-TIME RELEASE — discard half. Read the draft-minted credential
    // refs from its log BEFORE the discard drops the log + shadow; release them
    // AFTER the draft is gone (best-effort), gated so a ref another open draft
    // still references is never deleted.
    const artifactDb = ctx.artifactDb as ArtifactDb | undefined;
    const vault = ctx.vault as SecretVault | undefined;
    const mintedRefs =
      artifactDb != null
        ? extractDraftMintedRefs(await draftController.getDraftLog(draftId))
        : [];

    await draftController.discardDraft(draftId);

    if (artifactDb != null) {
      await releaseRefsAtTransition(artifactDb, vault, mintedRefs, draftId);
    }

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

export const draftLifecycleFunctions = {
  publishDraft,
  discardDraft,
  getDraftLog,
};

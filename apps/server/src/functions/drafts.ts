import type { ArtifactDb } from "@dashframe/server-core";
import type { PreviewDiff } from "@dashframe/types";
import { text } from "@wystack/db";
import type { Command, WyStackApp } from "@wystack/server";
import { query } from "@wystack/server";

import { createDraftController } from "../draft-controller";
import { findLateBound, type LateBoundOperandRef } from "../draft-late-bound";
import { buildPreviewDiff } from "./preview-diff";

export { findLateBound };
export type { LateBoundOperandRef };

export interface DraftPublishReview {
  draftId: string;
  commands: DraftCommandSummary[];
  diff: PreviewDiff;
  lateBound: LateBoundOperandRef[];
  publishBlocked: boolean;
}

export interface DraftCommandSummary {
  id?: string;
  path: string;
  hasArgs: boolean;
  lateBoundCount: number;
}

interface DraftFunctionContext {
  wyStackApp?: unknown;
  artifactDb?: unknown;
  vault?: unknown;
}

function asDraftFunctionContext(ctx: unknown): DraftFunctionContext {
  return ctx as DraftFunctionContext;
}

function requireServerContext(ctx: unknown): {
  app: WyStackApp;
  db: ArtifactDb;
} {
  const draftCtx = asDraftFunctionContext(ctx);
  const app = draftCtx.wyStackApp as WyStackApp | undefined;
  const db = draftCtx.artifactDb as ArtifactDb | undefined;
  if (!app || !db) {
    throw new Error(
      "draft functions require wyStackApp/artifactDb in handler context",
    );
  }
  return { app, db };
}

function summarizeCommands(
  commands: Command[],
  lateBound: LateBoundOperandRef[],
): DraftCommandSummary[] {
  return commands.map((command, commandIndex) => ({
    id: command.id,
    path: command.path,
    hasArgs: command.args !== undefined && command.args !== null,
    lateBoundCount: lateBound.filter(
      (entry) => entry.commandIndex === commandIndex,
    ).length,
  }));
}

function handlerContext(ctx: unknown): Record<string, unknown> {
  const draftCtx = asDraftFunctionContext(ctx);
  return draftCtx.vault !== undefined ? { vault: draftCtx.vault } : {};
}

const draftPublishReview = query({
  args: { draftId: text },
  handler: async (ctx, { draftId }): Promise<DraftPublishReview> => {
    const { app, db } = requireServerContext(ctx);
    const controller = createDraftController(app, db);
    const commands = await controller.getDraftLog(draftId);
    const lateBound = findLateBound(commands);
    const diff = await buildPreviewDiff(app, db, commands, handlerContext(ctx));
    return {
      draftId,
      commands: summarizeCommands(commands, lateBound),
      diff,
      lateBound,
      publishBlocked: lateBound.length > 0 || diff.error !== undefined,
    };
  },
});

export const draftFunctions = {
  draftPublishReview,
};

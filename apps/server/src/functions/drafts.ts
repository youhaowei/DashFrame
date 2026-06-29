import type { ArtifactDb } from "@dashframe/server-core";
import type { PreviewDiff } from "@dashframe/types";
import { text } from "@wystack/db";
import type { Command, WyStackApp } from "@wystack/server";
import { query } from "@wystack/server";

import { createDraftController } from "../draft-controller";
import { buildPreviewDiff } from "./preview-diff";

export interface LateBoundOperandRef {
  commandIndex: number;
  path: string;
  jsonPath: string;
  kind: string;
  label?: string;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectLateBound(
  value: unknown,
  path: string,
  out: Array<Omit<LateBoundOperandRef, "commandIndex" | "path">>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectLateBound(item, `${path}[${index}]`, out),
    );
    return;
  }
  if (!isRecord(value)) return;

  if (value.kind === "lateBound") {
    out.push({
      jsonPath: path,
      kind: "lateBound",
      label: typeof value.label === "string" ? value.label : undefined,
    });
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectLateBound(child, path ? `${path}.${key}` : key, out);
  }
}

export function findLateBound(commands: Command[]): LateBoundOperandRef[] {
  return commands.flatMap((command, commandIndex) => {
    const found: Array<Omit<LateBoundOperandRef, "commandIndex" | "path">> = [];
    collectLateBound(command.args, "args", found);
    return found.map((entry) => ({
      commandIndex,
      path: command.path,
      ...entry,
    }));
  });
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

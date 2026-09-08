import type { QueryCtx, MutationCtx } from "./_generated/server";
import { hostPrincipal } from "./lifecycleValues";
import { stable, command, record, type Json } from "./values";
import { replaceDraft } from "./app";
import { findLateBound } from "./lateBound";
import { redact } from "./preview";
import { openGraph, persist, draft, readGraph, log } from "./store";
import { execute } from "./engine";

export async function operation(
  ctx: QueryCtx,
  workspaceId: string,
  operationId: string,
  request: Json,
) {
  const existing = await ctx.db
    .query("operations")
    .withIndex("by_workspaceId_and_operationId", (q) =>
      q.eq("workspaceId", workspaceId).eq("operationId", operationId),
    )
    .unique();
  if (existing && stable(existing.request) !== stable(request))
    throw new Error("Operation ID reused with different payload");
  return existing;
}

export async function hostIdentity(
  ctx: QueryCtx,
  workspaceId: string,
  p: typeof hostPrincipal.type,
) {
  if (p.kind === "user")
    return { workspaceId, kind: "user" as const, owner: `user:${p.userId}` };
  const revoked = await ctx.db
    .query("revokedCredentials")
    .withIndex("by_workspaceId_and_credentialId", (q) =>
      q.eq("workspaceId", workspaceId).eq("credentialId", p.credentialId),
    )
    .unique();
  if (revoked) throw new Error("Credential revoked");
  return {
    workspaceId,
    kind: "service" as const,
    owner: `service:${p.credentialId}`,
  };
}

export async function runHostCommit(
  ctx: MutationCtx,
  args: {
    workspaceId: string;
    principal: typeof hostPrincipal.type;
    commands: (typeof command.type)[];
    operationId?: string;
  },
) {
  const who = await hostIdentity(ctx, args.workspaceId, args.principal);
  if (who.kind !== "user") throw new Error("User permission required");
  if (findLateBound(args.commands).length)
    throw new Error("Unbound operands cannot be committed");
  const op = args.operationId;
  if (op) {
    const old = await operation(ctx, args.workspaceId, op, args.commands);
    if (old)
      return old.result as {
        mode: "commit";
        commands: typeof args.commands;
        results: { id?: string; value: Json }[];
        tablesWritten: string[];
      };
  }
  const graph = openGraph(ctx, args.workspaceId),
    results = await execute(
      graph,
      args.commands,
      args.workspaceId,
      Date.now(),
      { host: true },
    ),
    tablesWritten = await persist(ctx, args.workspaceId, graph);
  const result = {
    mode: "commit" as const,
    commands: args.commands.map((c) => ({
      ...c,
      args: record(redact(c.args)),
    })),
    results,
    tablesWritten,
  };
  if (op)
    await ctx.db.insert("operations", {
      workspaceId: args.workspaceId,
      operationId: op,
      request: args.commands,
      result,
    });
  return result;
}

export async function runHostDraft(
  ctx: MutationCtx,
  args: {
    workspaceId: string;
    principal: typeof hostPrincipal.type;
    commands: (typeof command.type)[];
    draftId?: string;
  },
) {
  const who = await hostIdentity(ctx, args.workspaceId, args.principal);
  let row;
  if (args.draftId) row = await draft(ctx, who, args.draftId, true);
  else {
    const now = Date.now(),
      draftId = crypto.randomUUID(),
      id = await ctx.db.insert("drafts", {
        workspaceId: args.workspaceId,
        draftId,
        owner: who.owner,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        commandCount: 0,
      });
    row = (await ctx.db.get(id))!;
  }
  const graph = await readGraph(ctx, who, row.draftId),
    commands = [
      ...(await log(ctx, args.workspaceId, row.draftId)).map((e) => e.command),
      ...args.commands,
    ],
    results = await execute(
      graph,
      args.commands,
      args.workspaceId,
      Date.now(),
      { host: true, service: who.kind === "service" },
    );
  await replaceDraft(ctx, row, commands, graph);
  return { draftId: row.draftId, results };
}

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  admissionForSubject,
  hostedUserSubject,
  requireHostedAuthority,
} from "./admissionGuard";

const statusResult = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("revoked"),
    v.literal("admitted"),
  ),
  workspaceId: v.union(v.string(), v.null()),
});

function validateSubject(subject: string) {
  if (!subject || subject.trim() !== subject || subject.length > 256)
    throw new ConvexError("Invalid admission subject");
}

export const grant = mutation({
  args: { subject: v.string() },
  returns: v.null(),
  handler: async (ctx, { subject }) => {
    const operator = requireHostedAuthority(
      await ctx.auth.getUserIdentity(),
      "operator",
    );
    validateSubject(subject);
    const existing = await admissionForSubject(ctx, subject);
    if (existing?.status === "admitted") return null;
    const updatedAt = Date.now();
    const change = {
      status: "admitted" as const,
      updatedAt,
      updatedBy: operator.subject,
      revision: (existing?.revision ?? 0) + 1,
    };
    if (existing) await ctx.db.patch(existing._id, change);
    else
      await ctx.db.insert("admissions", {
        subject,
        createdAt: updatedAt,
        ...change,
      });
    return null;
  },
});

export const revoke = mutation({
  args: { subject: v.string() },
  returns: v.null(),
  handler: async (ctx, { subject }) => {
    const operator = requireHostedAuthority(
      await ctx.auth.getUserIdentity(),
      "operator",
    );
    validateSubject(subject);
    const existing = await admissionForSubject(ctx, subject);
    if (existing && existing.status !== "revoked")
      await ctx.db.patch(existing._id, {
        status: "revoked",
        updatedAt: Date.now(),
        updatedBy: operator.subject,
        revision: existing.revision + 1,
      });
    return null;
  },
});

export const status = query({
  args: {},
  returns: statusResult,
  handler: async (ctx): Promise<typeof statusResult.type> => {
    const identity = requireHostedAuthority(
      await ctx.auth.getUserIdentity(),
      "host",
    );
    const admission = await admissionForSubject(
      ctx,
      hostedUserSubject(identity),
    );
    return {
      status: admission?.status ?? "pending",
      workspaceId:
        admission?.status === "admitted"
          ? (admission.workspaceId ?? null)
          : null,
    };
  },
});

function newWorkspaceId() {
  // Convex supplies seeded strong randomness inside mutations for safe retries:
  // https://docs.convex.dev/functions/runtimes#using-randomness-and-time-in-queries-and-mutations
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (position) => {
    // oxlint-disable-next-line sonarjs/pseudo-random -- see above: Convex seeds Math.random with strong randomness in mutations
    const value = Math.floor(Math.random() * 16);
    return (position === "x" ? value : (value & 3) | 8).toString(16);
  });
}

export const resolve = mutation({
  args: {},
  returns: statusResult,
  handler: async (ctx): Promise<typeof statusResult.type> => {
    const identity = requireHostedAuthority(
      await ctx.auth.getUserIdentity(),
      "host",
    );
    const admission = await admissionForSubject(
      ctx,
      hostedUserSubject(identity),
    );
    if (!admission || admission.status !== "admitted")
      return { status: admission?.status ?? "pending", workspaceId: null };
    if (admission.workspaceId)
      return {
        status: "admitted" as const,
        workspaceId: admission.workspaceId,
      };
    const workspaceId = newWorkspaceId();
    const collision = await ctx.db
      .query("admissions")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    if (collision)
      throw new ConvexError("Workspace allocation conflict; retry");
    await ctx.db.patch(admission._id, { workspaceId });
    return { status: "admitted" as const, workspaceId };
  },
});

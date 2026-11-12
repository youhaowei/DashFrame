import { v } from "convex/values";

/** What a connected agent may do. Grant administration and secrets are never delegable. */
export const agentPermission = v.union(
  v.literal("read"),
  v.literal("draft"),
  v.literal("publish:create"),
  v.literal("publish:edit"),
  v.literal("delete"),
  v.literal("sources"),
);
export type AgentPermission = typeof agentPermission.type;

/** Matches today's named-credential behavior: read and draft, never publish. */
export const REVIEW_PERMISSIONS: AgentPermission[] = ["read", "draft"];

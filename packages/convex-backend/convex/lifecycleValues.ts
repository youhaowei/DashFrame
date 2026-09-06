import { v } from "convex/values";
import { command, json } from "./values";
export const hostPrincipal = v.union(
  v.object({ kind: v.literal("user"), userId: v.string() }),
  v.object({ kind: v.literal("service"), credentialId: v.string() }),
);
export const hostBatchResult = v.union(
  v.object({
    mode: v.literal("commit"),
    commands: v.array(command),
    results: v.array(v.object({ id: v.optional(v.string()), value: json })),
    tablesWritten: v.array(v.string()),
  }),
  v.object({
    draftId: v.string(),
    results: v.array(v.object({ id: v.optional(v.string()), value: json })),
  }),
);
export const hostBatchState = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("completed"),
    v.literal("cancelled"),
  ),
  result: v.union(hostBatchResult, v.null()),
});
export const hostBatchIdentity = {
  workspaceId: v.string(),
  operationId: v.string(),
  principal: hostPrincipal,
  requestHash: v.string(),
};
export const cleanupResource = v.object({
  kind: v.union(v.literal("frame"), v.literal("secret")),
  resourceId: v.string(),
});
export const cleanupItem = v.object({
  cleanupId: v.string(),
  ...cleanupResource.fields,
});
export const cleanupClaim = v.object({
  ...cleanupItem.fields,
  claimToken: v.string(),
});
export function principalOwner(principal: typeof hostPrincipal.type) {
  const id =
    principal.kind === "user" ? principal.userId : principal.credentialId;
  if (!id) throw new Error("Invalid principal");
  return `${principal.kind}:${id}`;
}

import type { CheckPermission } from "@wystack/server";

export const LOCAL_USER_ID = "local-user";

export const permission = {
  manageAccessCredentials: "accessCredentials.manage",
} as const;

const localUserPermissions = new Set<string>([
  permission.manageAccessCredentials,
]);

/** Current single-user permission lookup. Replace the adapter when users persist. */
export const checkPermission: CheckPermission = async (principal, required) =>
  principal.kind === "user" &&
  principal.userId === LOCAL_USER_ID &&
  localUserPermissions.has(required);

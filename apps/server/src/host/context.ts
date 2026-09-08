import type { AccessConnectionInfo } from "@dashframe/types";
import type { DataFrameStorage } from "@dashframe/engine";
import type {
  ArrowQueryRunner,
  ArrowTableRegistrar,
} from "@dashframe/engine-server/arrow-data-path";
import type { ApiAccessCredentials } from "@dashframe/server-core";
import type { Principal } from "@wystack/identity";
import type { SecretVault } from "@wystack/secret-vault";
import type { HostMetadata } from "./metadata";
import type { GoogleOAuthConfig } from "../connector-setup/oauth-provider";
import type { ApplicationOperations } from "./application";

/** Capabilities injected after HTTP authentication, never accepted from request JSON. */
export interface HostContext {
  principal: Principal;
  /** Personal workspace owner resolved by hosted admission, never request input.
   * Omitted only for the local desktop/loopback composition. */
  workspaceOwnerId?: string;
  /** Lifetime of the admitted hosted request. Omitted for local composition. */
  requestSignal?: AbortSignal;
  metadata: HostMetadata;
  cleanupResources?: () => Promise<void>;
  accessCredentials?: Pick<ApiAccessCredentials, "issue" | "list" | "revoke">;
  getServerEndpoint: () => string | undefined;
  accessConnectionInfo?: AccessConnectionInfo;
  vault?: SecretVault;
  googleOAuth?: GoogleOAuthConfig;
  application?: ApplicationOperations;
  dataFrameStorage?: DataFrameStorage;
  dataPlaneRuntime?: ArrowQueryRunner &
    Partial<Pick<ArrowTableRegistrar, "registerArrowTable">> & {
      unregisterTable?: (name: string) => Promise<void>;
    };
}

export type HostDataPlaneRuntime = NonNullable<HostContext["dataPlaneRuntime"]>;

export function requireUser(ctx: HostContext): void {
  if (ctx.principal.kind !== "user") throw new Error("FORBIDDEN");
}

export function isWorkspaceOwner(
  ctx: Pick<HostContext, "principal" | "workspaceOwnerId">,
): boolean {
  const ownerId = ctx.workspaceOwnerId ?? "local-user";
  return Boolean(
    ownerId &&
    ownerId.trim() === ownerId &&
    !/[\s\p{Cc}]/u.test(ownerId) &&
    ctx.principal.kind === "user" &&
    ctx.principal.userId === ownerId,
  );
}

export function requireWorkspaceOwner(
  ctx: Pick<HostContext, "principal" | "workspaceOwnerId">,
): void {
  if (!isWorkspaceOwner(ctx)) throw new Error("FORBIDDEN");
}

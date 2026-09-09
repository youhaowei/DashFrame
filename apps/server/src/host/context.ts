import type { AccessConnectionInfo } from "@dashframe/types";
import type { DataFrameStorage, QueryEngine } from "@dashframe/engine";
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
  /**
   * The engine, as one interface rather than a per-caller shape. Absent only
   * where no engine is bound to the composition at all. The facades that
   * supply it (`NativeTableLifecycle.engine`, `createHostedQueryRuntime`) do
   * not forward `initialize`/`dispose`: engine lifetime belongs to whoever
   * constructed it, never to a request.
   */
  dataPlaneRuntime?: QueryEngine & {
    /** Stable identity shared by request-scoped wrappers over one engine. */
    coalescingIdentity?: object;
    /**
     * True only for the in-process native engine. Materialization uses it to
     * decide whether to stream batches under the native transfer budget, or
     * buffer through the hosted surface's bounded adapter — which runs DuckDB
     * behind a request/response worker, where a "stream" is joined at the seam
     * and carries none of that budget's guarantees.
     *
     * Every backing implements `queryArrowBatches` and `registerArrowStream`,
     * so method presence can no longer answer this; the binding states it.
     */
    nativeTransfer?: boolean;
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

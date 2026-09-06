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
  metadata: HostMetadata;
  cleanupResources?: () => Promise<void>;
  accessCredentials?: ApiAccessCredentials;
  getServerEndpoint: () => string | undefined;
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

export function requireLocalOperator(ctx: HostContext): void {
  if (ctx.principal.kind !== "user" || ctx.principal.userId !== "local-user") {
    throw new Error("FORBIDDEN");
  }
}

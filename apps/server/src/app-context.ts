import type { DataFrameStorage } from "@dashframe/engine";
import type {
  ArrowQueryRunner,
  ArrowTableRegistrar,
} from "@dashframe/engine-server/arrow-data-path";
import type { ApiAccessCredentials, ArtifactDb } from "@dashframe/server-core";
import { isPrincipal, type Principal } from "@wystack/identity";
import type { SecretVault } from "@wystack/secret-vault";
import type { FunctionContext, WyStackApp } from "@wystack/server";

import type { GoogleOAuthConfig } from "./connector-setup/oauth-provider";
import type { DraftController } from "./draft-controller";

/**
 * Server-only native data-plane capability. It is injected by the host, never
 * read from RPC input, and deliberately carries no provider or credential data.
 */
export type DataPlaneRuntime = ArrowQueryRunner &
  Partial<Pick<ArrowTableRegistrar, "registerArrowTable">> & {
    unregisterTable?: (name: string) => Promise<void>;
  };

/** Host capabilities and request identity available to every WyStack procedure. */
export interface AppContext {
  principal?: Principal;
  accessCredentials?: ApiAccessCredentials;
  getServerEndpoint: () => string | undefined;
  vault?: SecretVault;
  wyStackApp?: WyStackApp;
  artifactDb?: ArtifactDb;
  dataFrameStorage?: DataFrameStorage;
  dataPlaneRuntime?: DataPlaneRuntime;
  captureServerFrameReferences?: () => Promise<ReadonlySet<string>>;
  cleanupDereferencedServerFrames?: (
    before: ReadonlySet<string>,
  ) => Promise<void>;
  unregisterServerFrames?: (ids: readonly string[]) => Promise<void>;
  markServerFrameCleanupHandled?: () => void;
  draftController?: DraftController;
  onWrite?: () => void;
  flushSnapshot?: () => Promise<void>;
  flushSnapshotRetentionWindow?: () => Promise<void>;
  googleOAuth?: GoogleOAuthConfig;
  mode?: string;
  draftId?: string;
  __publishReplay?: boolean;
  /**
   * Marks the connector-setup sweep as the one the server runs during startup,
   * which is allowed to recover in-flight rows immediately instead of waiting
   * out the abandonment grace window.
   *
   * Context, not procedure input, and deliberately so: an input field would let
   * any client send `graceMs: 0` and recover a session a live handler is still
   * working on — exactly the race the grace window exists to close. Only the
   * host process can set this.
   */
  __bootSweep?: boolean;
}

export type DashframeFunctionContext = FunctionContext<AppContext>;

/** Stable, non-secret identity used to bind durable resources to a principal. */
export function principalKey(principal: unknown): string | null {
  if (!isPrincipal(principal)) return null;
  return principal.kind === "service"
    ? `service:${principal.credentialId}`
    : `user:${principal.userId}`;
}

import type { ApiAccessCredentials, ArtifactDb } from "@dashframe/server-core";
import type { SecretVault } from "@wystack/secret-vault";
import type { FunctionContext, WyStackApp } from "@wystack/server";

import type { DraftController } from "./draft-controller";

/** Host capabilities and request identity available to every WyStack procedure. */
export interface AppContext {
  principal?: unknown;
  accessCredentials?: ApiAccessCredentials;
  getServerEndpoint: () => string | undefined;
  vault?: SecretVault;
  wyStackApp?: WyStackApp;
  artifactDb?: ArtifactDb;
  draftController?: DraftController;
  onWrite?: () => void;
  flushSnapshot?: () => Promise<void>;
  mode?: string;
  draftId?: string;
  __publishReplay?: boolean;
}

export type DashframeFunctionContext = FunctionContext<AppContext>;

import type { UseQueryResult } from "./repository-base";
import type { UUID } from "./uuid";

export interface AccessCredential {
  id: UUID;
  name: string;
  tokenPrefix: string;
  createdAt: number;
  revokedAt?: number;
}

export interface IssuedAccessCredential {
  credential: AccessCredential;
  /** Displayed once. DashFrame stores its verifier through SecretVault. */
  accessCredential: string;
}

export interface AccessConnectionInfo {
  endpoint: string;
  transport: "dashframe-http";
  authentication: "Bearer";
}

export interface AccessCapabilities {
  canManageCredentials: boolean;
}

export interface AccessCredentialMutations {
  issue: (name: string) => Promise<IssuedAccessCredential>;
  revoke: (id: UUID) => Promise<void>;
}

export interface UseAccessCredentialsResult extends UseQueryResult<
  AccessCredential[]
> {
  refetch: () => Promise<unknown>;
}
export type UseAccessConnectionInfoResult =
  UseQueryResult<AccessConnectionInfo>;
export type UseAccessCapabilitiesResult = UseQueryResult<AccessCapabilities>;

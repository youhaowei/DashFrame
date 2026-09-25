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
  transport: "dashframe-http" | "mcp";
  authentication: "Bearer";
}

export interface AccessCapabilities {
  canManageCredentials: boolean;
  /**
   * Why credentials cannot be managed, when they cannot: the host started
   * without a secret key (so it has no encrypted store for credentials or
   * data-source sign-ins), it started without an access token (so every
   * caller is anonymous), or the caller does not own the workspace.
   */
  unavailableReason?: "no-secret-key" | "no-host-token" | "not-owner";
}

export interface AccessCredentialMutations {
  issue: (name: string) => Promise<IssuedAccessCredential>;
  revoke: (id: UUID) => Promise<void>;
}

export interface UseAccessCredentialsResult extends UseQueryResult<
  AccessCredential[]
> {
  /** The list could not be read; `data` is then not an empty store. */
  isError?: boolean;
  refetch: () => Promise<unknown>;
}
export type UseAccessConnectionInfoResult =
  UseQueryResult<AccessConnectionInfo>;
export interface UseAccessCapabilitiesResult extends UseQueryResult<AccessCapabilities> {
  /** The host could not be asked; `data` is then not "cannot manage". */
  isError?: boolean;
  refetch?: () => Promise<unknown>;
}

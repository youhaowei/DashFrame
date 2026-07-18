import type { UseQueryResult } from "./repository-base";
import type { UUID } from "./uuid";

export interface HarnessAccessCredential {
  id: UUID;
  name: string;
  tokenPrefix: string;
  createdAt: number;
  revokedAt?: number;
}

export interface IssuedHarnessAccessCredential {
  credential: HarnessAccessCredential;
  /** Displayed once. DashFrame persists only a verifier. */
  accessCredential: string;
}

export interface HarnessConnectionInfo {
  projectId: UUID;
  projectName: string;
  endpoint: string;
  transport: "dashframe-http";
  authentication: "Bearer";
}

export interface HarnessAccessMutations {
  issue: (name: string) => Promise<IssuedHarnessAccessCredential>;
  revoke: (id: UUID) => Promise<void>;
}

export type UseHarnessAccessCredentialsResult = UseQueryResult<
  HarnessAccessCredential[]
>;
export type UseHarnessConnectionInfoResult =
  UseQueryResult<HarnessConnectionInfo>;

import type { UseQueryResult } from "./repository-base";
import type { UUID } from "./uuid";

export type AssistantProviderAuthKind = "api-key" | "local" | "oauth";

export interface AssistantProviderModelOption {
  id: string;
  name: string;
  providerId: string;
  api: string;
}

export interface AssistantProviderCatalogEntry {
  providerId: string;
  label: string;
  authKinds: AssistantProviderAuthKind[];
  defaultBaseUrl?: string;
  models: AssistantProviderModelOption[];
}

export interface AssistantProviderConfig {
  id: UUID;
  providerId: string;
  displayLabel: string;
  authKind: AssistantProviderAuthKind;
  baseUrl?: string;
  hasCredential: boolean;
  defaultModel: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SaveAssistantProviderConfigInput {
  id?: UUID;
  providerId: string;
  displayLabel: string;
  authKind: AssistantProviderAuthKind;
  baseUrl?: string;
  credential?: string;
  defaultModel: string;
  isDefault?: boolean;
}

export interface SetAssistantDefaultModelInput {
  id: UUID;
  defaultModel: string;
}

export interface AssistantProviderConfigMutations {
  save: (
    input: SaveAssistantProviderConfigInput,
  ) => Promise<AssistantProviderConfig>;
  remove: (id: UUID) => Promise<void>;
  setDefaultModel: (input: SetAssistantDefaultModelInput) => Promise<void>;
  startOAuthLogin: (id: UUID) => Promise<void>;
}

export type UseAssistantProviderConfigsResult = UseQueryResult<
  AssistantProviderConfig[]
>;
export type UseAssistantProviderCatalogResult = UseQueryResult<
  AssistantProviderCatalogEntry[]
>;

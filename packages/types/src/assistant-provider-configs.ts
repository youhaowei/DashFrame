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
  /** The model observed before this change; prevents stale writes from winning. */
  expectedDefaultModel: string;
  defaultModel: string;
}

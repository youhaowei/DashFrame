import {
  getModels,
  type Api,
  type KnownProvider,
  type Model,
  type ProviderStreamOptions,
} from "@earendil-works/pi-ai";
import {
  getOAuthProvider,
  type OAuthCredentials,
  type OAuthLoginCallbacks,
} from "@earendil-works/pi-ai/oauth";
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import { isSecretRef } from "@wystack/secret-vault";

import { resolveDefaultAnthropicModel } from "./model.js";

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

export interface StoredAssistantProviderConfig {
  id: string;
  providerId: string;
  displayLabel: string;
  authKind: AssistantProviderAuthKind;
  baseUrl?: string | null;
  credentialRef?: string | null;
  defaultModel: string;
}

export interface ResolvedAssistantProvider {
  model: Model<Api>;
  options: ProviderStreamOptions;
  rotatedCredential?: OAuthCredentials;
}

export async function loginAssistantProviderOAuth(
  providerId: string,
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`No pi OAuth provider registered for ${providerId}`);
  }
  return provider.login(callbacks);
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "ChatGPT Plus",
  openrouter: "OpenRouter",
  opencode: "OpenCode Zen",
  ollama: "Ollama",
  "lm-studio": "LM Studio",
};

const CATALOG_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "openai-codex",
  "openrouter",
  "opencode",
] as const;

const LOCAL_PROVIDERS: AssistantProviderCatalogEntry[] = [
  {
    providerId: "ollama",
    label: "Ollama",
    authKinds: ["local"],
    defaultBaseUrl: "http://localhost:11434/v1",
    models: [
      {
        id: "llama3.1",
        name: "llama3.1",
        providerId: "ollama",
        api: "openai-completions",
      },
    ],
  },
  {
    providerId: "lm-studio",
    label: "LM Studio",
    authKinds: ["local"],
    defaultBaseUrl: "http://localhost:1234/v1",
    models: [
      {
        id: "local-model",
        name: "Local model",
        providerId: "lm-studio",
        api: "openai-completions",
      },
    ],
  },
];

function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}

function mapModels(providerId: string): AssistantProviderModelOption[] {
  return (getModels(providerId as KnownProvider) as Model<Api>[]).map(
    (model) => ({
      id: model.id,
      name: model.name,
      providerId,
      api: model.api,
    }),
  );
}

function defaultBaseUrl(providerId: string): string | undefined {
  return (getModels(providerId as KnownProvider) as Model<Api>[])[0]?.baseUrl;
}

export function getAssistantProviderCatalog(): AssistantProviderCatalogEntry[] {
  return [
    ...CATALOG_PROVIDER_IDS.map((providerId) => ({
      providerId,
      label: providerLabel(providerId),
      defaultBaseUrl: defaultBaseUrl(providerId),
      authKinds: authKindsForProvider(providerId),
      models: mapModels(providerId),
    })),
    ...LOCAL_PROVIDERS,
  ];
}

function authKindsForProvider(providerId: string): AssistantProviderAuthKind[] {
  if (providerId === "anthropic") return ["api-key", "oauth"];
  if (providerId === "openai-codex") return ["oauth"];
  return ["api-key"];
}

function modelForConfig(config: StoredAssistantProviderConfig): Model<Api> {
  if (config.providerId === "anthropic" && !config.defaultModel) {
    return resolveDefaultAnthropicModel();
  }

  if (config.providerId === "ollama" || config.providerId === "lm-studio") {
    return {
      id: config.defaultModel,
      name: config.defaultModel,
      api: "openai-completions",
      provider: config.providerId,
      baseUrl: config.baseUrl ?? "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    };
  }

  const model = (
    getModels(config.providerId as KnownProvider) as Model<Api>[]
  ).find((candidate) => candidate.id === config.defaultModel);
  if (!model) {
    throw new Error(
      `Assistant provider model ${config.providerId}/${config.defaultModel} is not registered in pi`,
    );
  }
  return config.baseUrl ? { ...model, baseUrl: config.baseUrl } : model;
}

function parseOAuthCredentials(raw: string): OAuthCredentials {
  const parsed = JSON.parse(raw) as OAuthCredentials;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof parsed.access !== "string" ||
    typeof parsed.refresh !== "string" ||
    typeof parsed.expires !== "number"
  ) {
    throw new Error("Stored OAuth credential is malformed");
  }
  return parsed;
}

export async function resolveAssistantProvider(
  config: StoredAssistantProviderConfig,
  vault: SecretVault | undefined,
): Promise<ResolvedAssistantProvider> {
  const model = modelForConfig(config);

  if (config.authKind === "local") {
    return { model, options: { apiKey: "local" } };
  }

  const ref = config.credentialRef;
  if (!isSecretRef(ref)) {
    throw new Error(
      `Assistant provider ${config.displayLabel} has no stored credential`,
    );
  }
  if (vault == null) {
    throw new Error(
      "Assistant provider credential resolution requires a SecretVault",
    );
  }

  return vault.withSecret(ref as SecretRef, async (plaintext) => {
    if (config.authKind === "api-key") {
      return { model, options: { apiKey: plaintext } };
    }

    const provider = getOAuthProvider(config.providerId);
    if (!provider) {
      throw new Error(
        `No pi OAuth provider registered for ${config.providerId}`,
      );
    }
    const credentials = parseOAuthCredentials(plaintext);
    const freshCredentials =
      credentials.expires <= Date.now()
        ? await provider.refreshToken(credentials)
        : credentials;
    return {
      model,
      options: { apiKey: provider.getApiKey(freshCredentials) },
      rotatedCredential:
        freshCredentials === credentials ? undefined : freshCredentials,
    };
  });
}

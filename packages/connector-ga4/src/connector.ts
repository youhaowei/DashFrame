import type {
  ConnectorQueryResult,
  FormField,
  QueryOptions,
  RemoteDatabase,
  SecretResolver,
  UUID,
  ValidationResult,
} from "@dashframe/engine";
import { RemoteApiConnector, createFieldsFromColumns } from "@dashframe/engine";
import { tableFromArrays, tableToIPC } from "apache-arrow";

/**
 * The per-source credential persisted in the vault.
 *
 * Carries no client secret by design: that is one server-wide credential, not
 * per-source data. Storing it here would copy it into every connected source's
 * vault entry — multiplying the places it must be rotated out of, and letting
 * any single source's bundle disclose the secret for all of them. `clientId` is
 * not secret and stays, because it records which OAuth client minted the grant.
 */
export interface GoogleOAuthTokenBundle {
  version: 1;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
  scopes: string[];
}

/**
 * Client credentials the host supplies at call time, read from server config
 * and never persisted alongside a token bundle.
 */
export interface GoogleOAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

interface GoogleTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
}

/**
 * Write the renewed bundle back to wherever the host keeps it.
 *
 * Optional, and a failure to persist must not fail the request the refresh was
 * for: the freshly minted token is valid in memory either way. Without it the
 * connector re-refreshes on every call past expiry, which spends a Google
 * grant per request and eventually trips rate limits.
 */
export type PersistTokenBundle = (
  bundle: GoogleOAuthTokenBundle,
) => Promise<void>;

interface AccountSummariesResponse {
  accountSummaries?: Array<{
    propertySummaries?: Array<{ property?: unknown; displayName?: unknown }>;
  }>;
  nextPageToken?: unknown;
}

interface RunReportResponse {
  dimensionHeaders?: Array<{ name?: unknown }>;
  metricHeaders?: Array<{ name?: unknown; type?: unknown }>;
  rows?: Array<{
    dimensionValues?: Array<{ value?: unknown }>;
    metricValues?: Array<{ value?: unknown }>;
  }>;
}

export interface Ga4ConnectorDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  /**
   * OAuth client credentials for token refresh, read from server config by the
   * host that constructs this connector. Optional because the catalog and
   * client-registry construct a connector purely for its static metadata and
   * never reach a network path; a refresh without it fails closed.
   */
  oauthClient?: GoogleOAuthClientCredentials;
  /**
   * Write-back for a renewed token bundle. Optional for the same reason as
   * `oauthClient`; omitting it means every call past expiry burns a fresh
   * refresh grant.
   */
  persistTokenBundle?: PersistTokenBundle;
}

function parseTokenBundle(raw: string): GoogleOAuthTokenBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("[GA4Connector] Stored Google credential is malformed");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { accessToken?: unknown }).accessToken !== "string" ||
    typeof (parsed as { refreshToken?: unknown }).refreshToken !== "string" ||
    typeof (parsed as { expiresAt?: unknown }).expiresAt !== "number" ||
    typeof (parsed as { clientId?: unknown }).clientId !== "string" ||
    !Array.isArray((parsed as { scopes?: unknown }).scopes)
  ) {
    throw new Error("[GA4Connector] Stored Google credential is incomplete");
  }
  const bundle = parsed as GoogleOAuthTokenBundle;
  if (!bundle.scopes.every((scope) => typeof scope === "string")) {
    throw new Error(
      "[GA4Connector] Stored Google credential scopes are invalid",
    );
  }
  return bundle;
}

const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;

async function refreshAccessToken(
  bundle: GoogleOAuthTokenBundle,
  fetchImpl: typeof fetch,
  now: () => number,
  oauthClient: GoogleOAuthClientCredentials | undefined,
): Promise<GoogleOAuthTokenBundle> {
  if (!bundle.refreshToken) {
    throw new Error("[GA4Connector] Google authorization must be renewed");
  }
  // Fail closed rather than attempting an unauthenticated refresh: Google
  // rejects it anyway, and a clear message points at the missing server config.
  if (!oauthClient) {
    throw new Error(
      "[GA4Connector] Google OAuth client credentials are not configured",
    );
  }
  // A grant is bound to the client that minted it. If the server's configured
  // client has been replaced, the stored refresh token cannot be renewed under
  // the new one — say so instead of sending a mismatched pair and surfacing an
  // opaque provider error.
  if (bundle.clientId !== oauthClient.clientId) {
    throw new Error(
      "[GA4Connector] Google authorization was issued for a different OAuth client and must be renewed",
    );
  }
  const body = new URLSearchParams({
    client_id: oauthClient.clientId,
    client_secret: oauthClient.clientSecret,
    refresh_token: bundle.refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(
      `[GA4Connector] Google token refresh failed (${response.status})`,
    );
  }
  const token = (await response.json()) as GoogleTokenResponse;
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new Error("[GA4Connector] Google token refresh returned no token");
  }
  const lifetime =
    typeof token.expires_in === "number" && token.expires_in > 0
      ? token.expires_in
      : DEFAULT_TOKEN_LIFETIME_SECONDS;
  return {
    ...bundle,
    accessToken: token.access_token,
    // Google only returns a refresh token when it rotates one. Keep the
    // existing one otherwise, or the source loses its grant on first refresh.
    refreshToken:
      typeof token.refresh_token === "string" && token.refresh_token
        ? token.refresh_token
        : bundle.refreshToken,
    expiresAt: now() + lifetime * 1000,
  };
}

async function accessTokenFor(
  raw: string,
  fetchImpl: typeof fetch,
  now: () => number,
  oauthClient: GoogleOAuthClientCredentials | undefined,
  persist: PersistTokenBundle | undefined,
): Promise<string> {
  const bundle = parseTokenBundle(raw);
  if (bundle.expiresAt > now() + 60_000) return bundle.accessToken;
  const refreshed = await refreshAccessToken(
    bundle,
    fetchImpl,
    now,
    oauthClient,
  );
  if (persist) {
    try {
      await persist(refreshed);
    } catch (error) {
      // The token in hand is valid; only the write-back failed. Losing the
      // request over a storage problem is strictly worse than refreshing
      // again next time. Never include the bundle in what is logged.
      console.warn(
        `[GA4Connector] refreshed credential could not be persisted: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }
  return refreshed.accessToken;
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `[GA4Connector] Google API request failed (${response.status})`,
    );
  }
  return response.json();
}

function propertyResource(databaseId: string): string {
  const value = databaseId.startsWith("properties/")
    ? databaseId
    : `properties/${databaseId}`;
  if (!/^properties\/\d+$/u.test(value)) {
    throw new Error("[GA4Connector] Invalid GA4 property id");
  }
  return value;
}

function propertiesFrom(body: AccountSummariesResponse): RemoteDatabase[] {
  return (body.accountSummaries ?? []).flatMap((account) =>
    (account.propertySummaries ?? []).flatMap((property) =>
      typeof property.property === "string" &&
      typeof property.displayName === "string"
        ? [{ id: property.property, name: property.displayName }]
        : [],
    ),
  );
}

async function listProperties(
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<RemoteDatabase[]> {
  const properties: RemoteDatabase[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    );
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = (await fetchJson(
      fetchImpl,
      url.toString(),
      accessToken,
    )) as AccountSummariesResponse;
    properties.push(...propertiesFrom(body));
    pageToken =
      typeof body.nextPageToken === "string" && body.nextPageToken
        ? body.nextPageToken
        : undefined;
  } while (pageToken);
  return properties;
}

function dimensionValue(name: string, value: unknown): string | Date | null {
  if (typeof value !== "string") return null;
  if (name !== "date") return value;
  if (!/^\d{8}$/u.test(value)) return null;
  const date = new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export class Ga4Connector extends RemoteApiConnector {
  readonly id = "googleAnalytics";
  override readonly authKind = "oauth" as const;
  readonly name = "Google Analytics 4";
  readonly description = "Connect a Google Analytics account.";
  readonly icon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#F9AB00" d="M18.7 2.2a3.1 3.1 0 0 0-3.1 3.1v13.4a3.1 3.1 0 1 0 6.2 0V5.3a3.1 3.1 0 0 0-3.1-3.1Z"/><path fill="#E37400" d="M10.9 8.4a3.1 3.1 0 0 0-3.1 3.1v7.2a3.1 3.1 0 1 0 6.2 0v-7.2a3.1 3.1 0 0 0-3.1-3.1Z"/><circle cx="3.1" cy="18.7" r="3.1" fill="#E37400"/></svg>`;

  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #oauthClient: GoogleOAuthClientCredentials | undefined;
  readonly #persistTokenBundle: PersistTokenBundle | undefined;

  constructor(
    auth: SecretResolver,
    dependencies: Ga4ConnectorDependencies = {},
  ) {
    super(auth);
    this.#fetch = dependencies.fetch ?? fetch;
    this.#now = dependencies.now ?? Date.now;
    this.#oauthClient = dependencies.oauthClient;
    this.#persistTokenBundle = dependencies.persistTokenBundle;
  }

  getFormFields(): FormField[] {
    return [];
  }

  validate(): ValidationResult {
    return { valid: true };
  }

  async connect(): Promise<RemoteDatabase[]> {
    return this.auth(async (raw) => {
      const token = await accessTokenFor(
        raw,
        this.#fetch,
        this.#now,
        this.#oauthClient,
        this.#persistTokenBundle,
      );
      return listProperties(this.#fetch, token);
    });
  }

  async query(
    databaseId: string,
    tableId: UUID,
    options?: QueryOptions,
  ): Promise<ConnectorQueryResult> {
    const property = propertyResource(databaseId);
    const offset = options?.pagination?.offset ?? 0;
    const limit = options?.pagination?.limit ?? 10_000;
    if (offset < 0 || limit <= 0) {
      throw new Error("[GA4Connector] Invalid report pagination");
    }

    return this.auth(async (raw) => {
      const token = await accessTokenFor(
        raw,
        this.#fetch,
        this.#now,
        this.#oauthClient,
        this.#persistTokenBundle,
      );
      const response = (await fetchJson(
        this.#fetch,
        `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
            dimensions: [{ name: "date" }],
            metrics: [{ name: "activeUsers" }],
            offset: String(offset),
            limit: String(limit),
            orderBys: [{ dimension: { dimensionName: "date" } }],
          }),
        },
      )) as RunReportResponse;

      const dimensionNames = (response.dimensionHeaders ?? []).map((header) =>
        typeof header.name === "string" ? header.name : "dimension",
      );
      const metricNames = (response.metricHeaders ?? []).map((header) =>
        typeof header.name === "string" ? header.name : "metric",
      );
      const columns = [
        ...dimensionNames.map((name) => ({
          name,
          type: name === "date" ? ("date" as const) : ("string" as const),
        })),
        ...metricNames.map((name) => ({ name, type: "number" as const })),
      ];
      const fields = createFieldsFromColumns(columns, tableId);
      const arrays: Record<string, unknown[]> = Object.create(null) as Record<
        string,
        unknown[]
      >;
      for (const name of dimensionNames) arrays[name] = [];
      for (const name of metricNames) arrays[name] = [];

      for (const row of response.rows ?? []) {
        dimensionNames.forEach((name, index) => {
          const value = row.dimensionValues?.[index]?.value;
          arrays[name]!.push(dimensionValue(name, value));
        });
        metricNames.forEach((name, index) => {
          const value = row.metricValues?.[index]?.value;
          const numeric = typeof value === "string" ? Number(value) : NaN;
          arrays[name]!.push(Number.isFinite(numeric) ? numeric : null);
        });
      }

      const arrow = tableFromArrays(arrays);
      return {
        arrowBuffer: Buffer.from(tableToIPC(arrow)).toString("base64"),
        fieldIds: fields.map((field) => field.id),
        fields,
        rowCount: response.rows?.length ?? 0,
      };
    });
  }
}

export function makeGa4Connector(
  auth: SecretResolver,
  dependencies?: Ga4ConnectorDependencies,
): Ga4Connector {
  return new Ga4Connector(auth, dependencies);
}

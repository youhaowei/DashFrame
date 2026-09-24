import type {
  ConnectorFieldMetadata,
  ConnectorQueryResult,
  DefinitionConnector,
  DefinitionCompatibility,
  DefinitionQueryOptions,
  FormField,
  QueryOptions,
  RemoteDatabase,
  SecretResolver,
  UUID,
  ValidationResult,
} from "@dashframe/engine";
import type { Metric } from "@dashframe/types";
import { RemoteApiConnector } from "@dashframe/engine";

import { checkCompatibility } from "./compatibility.js";
import type { Ga4TableDefinition } from "./definition.js";
import {
  contractFor,
  getMetadata,
  propertyResource,
  type Ga4ApiClient,
} from "./metadata.js";
import { legacyDefinition, runReport, yearWeekStart } from "./query.js";

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
 * The stored Google grant can no longer be used: it is missing, malformed,
 * revoked, expired past refresh, or minted for another OAuth client. Only a new
 * Google sign-in fixes it, so hosts can tell the user that instead of showing a
 * generic failure.
 */
export class GoogleAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthorizationError";
  }
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

const ACQUISITION_METRICS = [
  "activeUsers",
  "newUsers",
  "sessions",
  "engagedSessions",
  "engagementRate",
  "keyEvents",
  "totalRevenue",
] as const;

/** What people call each acquisition column; `columnName` keeps the API name. */
const ACQUISITION_FIELD_NAMES: Readonly<Record<string, string>> = {
  yearWeek: "Week",
  sessionDefaultChannelGroup: "Channel",
  activeUsers: "Active users",
  newUsers: "New users",
  sessions: "Sessions",
  engagedSessions: "Engaged sessions",
  engagementRate: "Engagement rate",
  keyEvents: "Key events",
  totalRevenue: "Revenue",
};

/**
 * The measures a freshly imported acquisition table starts with, replacing the
 * generic row Count, which means nothing for pre-aggregated weekly rows.
 *
 * Revenue carries no currency code: the report does not return the property's
 * currency, so the formatter's default applies until someone sets it.
 */
export function acquisitionMeasures(
  tableId: UUID,
  makeId: () => string = () => crypto.randomUUID(),
): Metric[] {
  const sum = (
    columnName: (typeof ACQUISITION_METRICS)[number],
    format?: Metric["format"],
  ): Metric => ({
    id: makeId() as UUID,
    name: `Sum of ${ACQUISITION_FIELD_NAMES[columnName]}`,
    tableId,
    columnName,
    aggregation: "sum",
    contract: contractFor(columnName),
    ...(format ? { format } : {}),
  });
  const sessions = sum("sessions");
  const engagedSessions = sum("engagedSessions");
  return [
    {
      id: makeId() as UUID,
      name: "Active users",
      tableId,
      columnName: "activeUsers",
      aggregation: "sum",
      contract: { kind: "non-additive" },
    },
    sum("newUsers"),
    sessions,
    engagedSessions,
    sum("keyEvents"),
    sum("totalRevenue", { style: "currency" }),
    {
      // A ratio of sums, not an average of weekly rates: a per-row rate
      // averaged across channels would weight a 3-session week like a
      // 3,000-session one.
      id: makeId() as UUID,
      name: "Engagement rate",
      tableId,
      aggregation: "sum",
      expression: {
        kind: "binary",
        operator: "divide",
        left: { kind: "measure", measureId: engagedSessions.id },
        right: { kind: "measure", measureId: sessions.id },
      },
      format: { style: "percent" },
      contract: { kind: "ratio" },
    },
  ];
}

export type Ga4ReportVersion = "v1" | "v2";

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
  /**
   * Versioned server-owned report shape. Existing persisted sources default to
   * v1; newly onboarded acquisition sources opt into v2 explicitly.
   */
  reportVersion?: Ga4ReportVersion;
}

function parseTokenBundle(raw: string): GoogleOAuthTokenBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GoogleAuthorizationError(
      "[GA4Connector] Stored Google credential is malformed",
    );
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
    throw new GoogleAuthorizationError(
      "[GA4Connector] Stored Google credential is incomplete",
    );
  }
  const bundle = parsed as GoogleOAuthTokenBundle;
  if (!bundle.scopes.every((scope) => typeof scope === "string")) {
    throw new GoogleAuthorizationError(
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
  signal?: AbortSignal,
): Promise<GoogleOAuthTokenBundle> {
  if (!bundle.refreshToken) {
    throw new GoogleAuthorizationError(
      "[GA4Connector] Google authorization must be renewed",
    );
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
    throw new GoogleAuthorizationError(
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
    signal,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const message = `[GA4Connector] Google token refresh failed (${response.status})`;
    // Google answers a revoked or expired refresh token with 400
    // `invalid_grant` (401 for a rejected client). Anything else is transient.
    if (response.status === 400 || response.status === 401) {
      throw new GoogleAuthorizationError(message);
    }
    throw new Error(message);
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
  signal?: AbortSignal,
): Promise<string> {
  const bundle = parseTokenBundle(raw);
  if (bundle.expiresAt > now() + 60_000) return bundle.accessToken;
  const refreshed = await refreshAccessToken(
    bundle,
    fetchImpl,
    now,
    oauthClient,
    signal,
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

async function fetchGoogleResponse(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<Response> {
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
    const message = `[GA4Connector] Google API request failed (${response.status})`;
    if (response.status === 401) throw new GoogleAuthorizationError(message);
    throw new Error(message);
  }
  return response;
}

async function readMeasuredJson(
  response: Response,
  maxResponseBytes: number,
): Promise<{ body: unknown; byteLength: number }> {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0)
    throw new Error("[GA4Connector] Invalid response budget");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("[GA4Connector] Empty response body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) throw new Error("SOURCE_RESULT_TOO_LARGE");
      chunks.push(value);
    }
    return {
      body: JSON.parse(
        Buffer.concat(chunks, bytes).toString("utf8"),
      ) as unknown,
      byteLength: bytes,
    };
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
  init?: RequestInit,
  maxResponseBytes?: number,
): Promise<unknown> {
  const response = await fetchGoogleResponse(fetchImpl, url, accessToken, init);
  if (maxResponseBytes === undefined) return response.json();
  return (await readMeasuredJson(response, maxResponseBytes)).body;
}

async function fetchJsonMeasured(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
  init: RequestInit | undefined,
  maxResponseBytes: number,
): Promise<{ body: unknown; byteLength: number }> {
  const response = await fetchGoogleResponse(fetchImpl, url, accessToken, init);
  return readMeasuredJson(response, maxResponseBytes);
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

export class Ga4Connector
  extends RemoteApiConnector
  implements DefinitionConnector
{
  readonly id = "googleAnalytics";
  override readonly authKind = "oauth" as const;
  readonly name = "Google Analytics 4";
  readonly description = "Connect a Google Analytics account.";
  readonly icon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#F9AB00" d="M18.7 2.2a3.1 3.1 0 0 0-3.1 3.1v13.4a3.1 3.1 0 1 0 6.2 0V5.3a3.1 3.1 0 0 0-3.1-3.1Z"/><path fill="#E37400" d="M10.9 8.4a3.1 3.1 0 0 0-3.1 3.1v7.2a3.1 3.1 0 1 0 6.2 0v-7.2a3.1 3.1 0 0 0-3.1-3.1Z"/><circle cx="3.1" cy="18.7" r="3.1" fill="#E37400"/></svg>`;

  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #oauthClient: GoogleOAuthClientCredentials | undefined;
  readonly #persistTokenBundle: PersistTokenBundle | undefined;
  readonly #reportVersion: Ga4ReportVersion;
  readonly #propertyTimeZones = new Map<string, Promise<string>>();

  constructor(
    auth: SecretResolver,
    dependencies: Ga4ConnectorDependencies = {},
  ) {
    super(auth);
    this.#fetch = dependencies.fetch ?? fetch;
    this.#now = dependencies.now ?? Date.now;
    this.#oauthClient = dependencies.oauthClient;
    this.#persistTokenBundle = dependencies.persistTokenBundle;
    this.#reportVersion = dependencies.reportVersion ?? "v1";
  }

  /** Measures a newly imported table of this source starts with. */
  defaultMeasures(tableId: UUID): Metric[] {
    return this.#reportVersion === "v2" ? acquisitionMeasures(tableId) : [];
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

  #apiClient(accessToken: string): Ga4ApiClient {
    return {
      request: (url, init, requestMaxResponseBytes) =>
        fetchJson(this.#fetch, url, accessToken, init, requestMaxResponseBytes),
      requestMeasured: (url, init, requestMaxResponseBytes) =>
        fetchJsonMeasured(
          this.#fetch,
          url,
          accessToken,
          init,
          requestMaxResponseBytes,
        ),
    };
  }

  async #withClient<T>(
    use: (client: Ga4ApiClient) => Promise<T>,
    options?: QueryOptions,
  ): Promise<T> {
    options?.signal?.throwIfAborted();
    return this.auth(async (raw) => {
      const token = await accessTokenFor(
        raw,
        this.#fetch,
        this.#now,
        this.#oauthClient,
        this.#persistTokenBundle,
        options?.signal,
      );
      return use(this.#apiClient(token));
    });
  }

  async #timeZoneFor(property: string, client: Ga4ApiClient): Promise<string> {
    const cached = this.#propertyTimeZones.get(property);
    if (cached) return cached;
    const pending = client
      .request(`https://analyticsadmin.googleapis.com/v1beta/${property}`)
      .then((body) => {
        const timeZone = (body as { timeZone?: unknown }).timeZone;
        if (typeof timeZone !== "string" || !timeZone) {
          throw new Error(
            "[GA4Connector] Property returned no reporting time zone",
          );
        }
        // Validate the provider value before caching it for calendar math.
        new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
        return timeZone;
      });
    this.#propertyTimeZones.set(property, pending);
    try {
      return await pending;
    } catch (error) {
      this.#propertyTimeZones.delete(property);
      throw error;
    }
  }

  async query(
    databaseId: string,
    tableId: UUID,
    options?: QueryOptions,
  ): Promise<ConnectorQueryResult> {
    propertyResource(databaseId);
    const page = {
      offset: options?.pagination?.offset ?? 0,
      limit: options?.pagination?.limit ?? 10_000,
      single: true as const,
    };
    if (page.offset < 0 || page.limit <= 0) {
      throw new Error("[GA4Connector] Invalid report pagination");
    }
    const now = this.#now();
    return this.#withClient(
      (client) =>
        runReport(
          databaseId,
          legacyDefinition(this.#reportVersion, now),
          client,
          {
            ...options,
            tableId,
            now,
            page,
            allowLegacyYearWeek: this.#reportVersion === "v2",
            legacyDateRange:
              this.#reportVersion === "v2" ? "90daysAgo" : "30daysAgo",
            ...(this.#reportVersion === "v2"
              ? { labels: ACQUISITION_FIELD_NAMES }
              : {}),
          },
        ),
      options,
    );
  }

  async queryDefinition(
    site: string,
    definition: Ga4TableDefinition,
    options: DefinitionQueryOptions,
  ): Promise<ConnectorQueryResult> {
    const property = propertyResource(site);
    return this.#withClient(async (client) => {
      const timeZone =
        definition.dateRange.kind === "relative"
          ? await this.#timeZoneFor(property, client)
          : undefined;
      return runReport(site, definition, client, {
        ...options,
        now: this.#now(),
        ...(timeZone ? { timeZone } : {}),
      });
    }, options);
  }

  async listFields(site: string): Promise<ConnectorFieldMetadata[]> {
    propertyResource(site);
    return this.#withClient((client) => getMetadata(site, client));
  }

  async checkDefinition(
    site: string,
    definition: Ga4TableDefinition,
  ): Promise<DefinitionCompatibility> {
    propertyResource(site);
    return this.#withClient((client) =>
      checkCompatibility(site, definition, client),
    );
  }
}

export function makeGa4Connector(
  auth: SecretResolver,
  dependencies?: Ga4ConnectorDependencies,
): Ga4Connector {
  return new Ga4Connector(auth, dependencies);
}

export { yearWeekStart };

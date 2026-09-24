import type {
  ConnectorQueryResult,
  FormField,
  QueryOptions,
  RemoteDatabase,
  SecretResolver,
  UUID,
  ValidationResult,
} from "@dashframe/engine";
import type { Metric } from "@dashframe/types";
import { RemoteApiConnector, createFieldsFromColumns } from "@dashframe/engine";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { GA4_FIELD_SCOPES, ga4MeasureContract } from "./measure-metadata.js";

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

interface RunReportResponse {
  dimensionHeaders?: Array<{ name?: unknown }>;
  metricHeaders?: Array<{ name?: unknown; type?: unknown }>;
  rows?: Array<{
    dimensionValues?: Array<{ value?: unknown }>;
    metricValues?: Array<{ value?: unknown }>;
  }>;
}

/**
 * The v0.3 server-owned GA4 dataset used to build acquisition reviews.
 *
 * The connector, rather than the renderer or RPC caller, owns this provider
 * query. GA4 owns the weekly aggregation because user metrics such as
 * activeUsers are not additive across daily rows.
 */
const ACQUISITION_DATE_RANGE = {
  startDate: "90daysAgo",
  endDate: "yesterday",
} as const;
const ACQUISITION_DIMENSIONS = [
  "yearWeek",
  "sessionDefaultChannelGroup",
] as const;
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
const ACQUISITION_FIELD_NAMES: Readonly<
  Record<
    | (typeof ACQUISITION_DIMENSIONS)[number]
    | (typeof ACQUISITION_METRICS)[number],
    string
  >
> = {
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

const DATE_DIMENSIONS: ReadonlySet<string> = new Set(["date", "yearWeek"]);

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
    contract: ga4MeasureContract(columnName, "sum"),
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
      contract: ga4MeasureContract("activeUsers", "sum"),
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

const LEGACY_DATE_RANGE = {
  startDate: "30daysAgo",
  endDate: "yesterday",
} as const;
const LEGACY_DIMENSIONS = ["date"] as const;
const LEGACY_METRICS = ["activeUsers"] as const;

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

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
  init?: RequestInit,
  maxResponseBytes?: number,
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
    const message = `[GA4Connector] Google API request failed (${response.status})`;
    if (response.status === 401) throw new GoogleAuthorizationError(message);
    throw new Error(message);
  }
  if (maxResponseBytes === undefined) return response.json();
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
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
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

/**
 * The first day of a GA4 `yearWeek` such as "202601".
 *
 * GA4 weeks are not ISO weeks: they start on Sunday, and January 1st always
 * falls in week 01, so the first (and usually last) week of a year is short.
 * Week 01 therefore starts on January 1st and week n on the (n-1)th Sunday
 * after it.
 */
export function yearWeekStart(value: string): Date | null {
  const match = /^(\d{4})(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  const january1 = Date.UTC(year, 0, 1);
  const offsetDays =
    week === 1 ? 0 : 7 - new Date(january1).getUTCDay() + 7 * (week - 2);
  const start = new Date(january1 + offsetDays * 86_400_000);
  return start.getUTCFullYear() === year ? start : null;
}

function dimensionValue(name: string, value: unknown): string | Date | null {
  if (typeof value !== "string") return null;
  if (name === "yearWeek") return yearWeekStart(value);
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
  readonly #reportVersion: Ga4ReportVersion;

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

  async query(
    databaseId: string,
    tableId: UUID,
    options?: QueryOptions,
  ): Promise<ConnectorQueryResult> {
    options?.signal?.throwIfAborted();
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
        options?.signal,
      );
      const acquisition = this.#reportVersion === "v2";
      const dateRange = acquisition
        ? ACQUISITION_DATE_RANGE
        : LEGACY_DATE_RANGE;
      const dimensions = acquisition
        ? ACQUISITION_DIMENSIONS
        : LEGACY_DIMENSIONS;
      const metrics = acquisition ? ACQUISITION_METRICS : LEGACY_METRICS;
      const response = (await fetchJson(
        this.#fetch,
        `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
        token,
        {
          method: "POST",
          signal: options?.signal,
          body: JSON.stringify({
            dateRanges: [dateRange],
            dimensions: dimensions.map((name) => ({ name })),
            metrics: metrics.map((name) => ({ name })),
            offset: String(offset),
            limit: String(limit),
            // Every dimension participates so offset pagination is stable
            // when the report contains repeated values in its leading key.
            orderBys: dimensions.map((dimensionName) => ({
              dimension: { dimensionName },
            })),
          }),
        },
        options?.maxResponseBytes,
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
          type: DATE_DIMENSIONS.has(name)
            ? ("date" as const)
            : ("string" as const),
        })),
        ...metricNames.map((name) => ({ name, type: "number" as const })),
      ];
      const fields = createFieldsFromColumns(columns, tableId).map((field) => {
        const label = acquisition
          ? (ACQUISITION_FIELD_NAMES as Record<string, string | undefined>)[
              field.name
            ]
          : undefined;
        const scope =
          GA4_FIELD_SCOPES[
            (field.columnName ?? field.name) as keyof typeof GA4_FIELD_SCOPES
          ];
        return {
          ...field,
          ...(label ? { name: label } : {}),
          ...(scope ? { scope } : {}),
        };
      });
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

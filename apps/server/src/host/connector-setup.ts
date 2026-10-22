import { persistVerifiedSource } from "./verified-source";
import {
  makeGa4Connector,
  type GoogleOAuthTokenBundle,
} from "@dashframe/connector-ga4";
import type { UUID } from "@dashframe/types";
import { z } from "zod";

import type { HostContext } from "./context";
import { hostOperation } from "./operation";
import { persistGa4TokenBundle } from "./connectors";
import {
  OAuthExchangeError,
  connectorResumeLink,
  oauthConnectorDescriptorFor,
  resolveOAuthRedirectUri,
} from "../connector-setup/oauth-provider";
import {
  ConnectorSetupGateError,
  consumeCallback,
  effectiveState,
  markConnected,
  markFailed,
  markVerifying,
  oauthStateFor,
  publicResumeInfo,
  readSession,
  startSession,
  sweep,
  type ConnectorSetupSessionRow,
  type ConnectorSetupState,
  type SessionIssuance,
} from "../connector-setup/session-store";

export interface ConnectorSetupSessionDto {
  sessionId: string;
  connectorId: string;
  requestedName: string;
  state: ConnectorSetupState;
  authorizeUrl?: string;
  resumeUrl: string;
  dataSourceId?: string;
  failureCode?: string;
  failureMessage?: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface PublicConnectorSetupResumeDto {
  sessionId: string;
  connectorId: string;
  state: "awaiting-user-auth" | "connected" | "failed" | "expired";
  authorizeUrl?: string;
  expiresAt: number;
}

function googleOAuth(ctx: HostContext) {
  if (!ctx.googleOAuth) {
    throw new Error("Google Analytics OAuth is not configured");
  }
  return ctx.googleOAuth;
}

function descriptorFor(ctx: HostContext, connectorId: string) {
  return oauthConnectorDescriptorFor(connectorId, googleOAuth(ctx));
}

function redirectUriFor(ctx: HostContext): string {
  return resolveOAuthRedirectUri(
    ctx.getServerEndpoint(),
    googleOAuth(ctx).redirectBase,
  );
}

function authorizeUrlFor(ctx: HostContext, issuance: SessionIssuance): string {
  const descriptor = descriptorFor(ctx, issuance.session.connectorId);
  return descriptor.buildAuthorizeUrl({
    redirectUri: redirectUriFor(ctx),
    state: oauthStateFor(issuance.stateNonce),
    codeVerifier: issuance.session.codeVerifier,
  });
}

function fullDto(
  ctx: HostContext,
  row: ConnectorSetupSessionRow,
  authorizeUrl?: string,
): ConnectorSetupSessionDto {
  return {
    sessionId: row.id,
    connectorId: row.connectorId,
    requestedName: row.requestedName,
    state: effectiveState(row),
    ...(authorizeUrl ? { authorizeUrl } : {}),
    resumeUrl: connectorResumeLink(ctx.getServerEndpoint(), row.id),
    ...(row.dataSourceId ? { dataSourceId: row.dataSourceId } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
    ...(row.failureMessage ? { failureMessage: row.failureMessage } : {}),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hasCompletedAuthorization(
  oauthError: string | undefined,
  code: string | undefined,
): code is string {
  return !oauthError && Boolean(code);
}

function isRedirectUriMismatch(error: unknown): boolean {
  return error instanceof OAuthExchangeError && error.redirectUriMismatch;
}

async function probeSampleReport(
  probe: ReturnType<typeof makeGa4Connector>,
  propertyId: string | undefined,
): Promise<void> {
  if (!propertyId) return;
  // Throwaway id: only used to tag the discarded result's Arrow field ids.
  const probeTableId = crypto.randomUUID();
  await probe.query(propertyId, probeTableId, {
    pagination: { offset: 0, limit: 1 },
  });
}

type SetupFailure = { code: string; message: string };

/** "properties/1, properties/2, and 3 more" */
function listProperties(resources: string[]): string {
  const shown = resources.slice(0, 3).join(", ");
  const rest = resources.length - 3;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
}

/** Every remote resource a source's tables read, however many tables it has. */
async function allDataTableResources(
  ctx: HostContext,
  dataSourceId: string,
): Promise<string[]> {
  const resources = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const result = await ctx.metadata.listDataTableResources(
      dataSourceId,
      cursor,
    );
    for (const resource of result.page) resources.add(resource);
    if (result.isDone) return [...resources];
    cursor = result.continueCursor;
  }
}

/**
 * Which property proves reporting access. A new source has only the grant's
 * own properties. Signing in again must reach every property the source's
 * tables read, and the report probe runs against one of those.
 */
async function reportProbeTarget(
  ctx: HostContext,
  session: ConnectorSetupSessionRow,
  properties: { id: string }[],
): Promise<{ propertyId: string | undefined } | SetupFailure> {
  if (!session.reconnectDataSourceId) return { propertyId: properties[0]?.id };
  let resources: string[];
  try {
    resources = await allDataTableResources(ctx, session.reconnectDataSourceId);
  } catch {
    return {
      code: "reconnect-failed",
      message: "The data source could not be read. Try again.",
    };
  }
  const reachable = new Set(properties.map((p) => propertyNumber(p.id)));
  const unreachable = [
    ...new Set(
      resources.filter((resource) => !reachable.has(propertyNumber(resource))),
    ),
  ];
  if (unreachable.length > 0) {
    return {
      code: "account-mismatch",
      message: `This Google account can't reach ${listProperties(unreachable)}, which this source's tables use. Sign in with an account that can, or delete the tables that use them.`,
    };
  }
  return { propertyId: resources[0] ?? properties[0]?.id };
}

/** Prove the new grant can read the reports this source will run. */
async function verifyReportAccess(
  ctx: HostContext,
  session: ConnectorSetupSessionRow,
  probe: ReturnType<typeof makeGa4Connector>,
  properties: { id: string }[],
): Promise<SetupFailure | null> {
  const target = await reportProbeTarget(ctx, session, properties);
  if ("code" in target) return target;
  try {
    await probeSampleReport(probe, target.propertyId);
    return null;
  } catch {
    return {
      code: "report-probe-failed",
      message:
        "Google Analytics could not be verified: reporting access is missing or restricted for this account.",
    };
  }
}

function publicDto(
  row: ConnectorSetupSessionRow,
  authorizeUrl?: string,
): PublicConnectorSetupResumeDto {
  const reported = effectiveState(row);
  const state =
    reported === "connected" || reported === "failed" || reported === "expired"
      ? reported
      : "awaiting-user-auth";
  return {
    sessionId: row.id,
    connectorId: row.connectorId,
    state,
    ...(state === "awaiting-user-auth" && authorizeUrl ? { authorizeUrl } : {}),
    expiresAt: row.expiresAt,
  };
}

async function consumeForCompletion(
  ctx: HostContext,
  state: string,
): Promise<
  { session: ConnectorSetupSessionRow } | { expired: ConnectorSetupSessionDto }
> {
  try {
    return {
      session: await consumeCallback(ctx.metadata.connectorSetup, state),
    };
  } catch (error) {
    if (
      error instanceof ConnectorSetupGateError &&
      error.code === "session-expired" &&
      error.session
    ) {
      // The expiry mutation has already committed before the callback returns.
      return { expired: fullDto(ctx, error.session) };
    }
    throw error;
  }
}

/** GA4 resource ids appear both as `properties/123` and as the bare number. */
function propertyNumber(resource: string): string {
  return resource.replace(/^properties\//u, "");
}

/**
 * Swap a verified grant into an existing source, keeping its id, tables, and
 * everything built on them. Runs only after `verifyReportAccess` showed the
 * new grant reaches every property the source's tables read, so a sign-in
 * with the wrong Google account never gets here and the source stays as it was.
 */
async function renewSourceGrant(
  ctx: HostContext,
  dataSourceId: string,
  tokenBundle: string,
): Promise<SetupFailure | null> {
  let source: Awaited<ReturnType<typeof ctx.metadata.getDataSource>>;
  try {
    source = await ctx.metadata.getDataSource(dataSourceId);
  } catch {
    return {
      code: "reconnect-failed",
      message: "The data source could not be read. Try again.",
    };
  }
  if (source?.kind !== "googleAnalytics") {
    return {
      code: "reconnect-target-missing",
      message: "This data source no longer exists.",
    };
  }
  try {
    await persistGa4TokenBundle(
      ctx,
      dataSourceId as UUID,
      ctx.vault,
      JSON.parse(tokenBundle) as GoogleOAuthTokenBundle,
      { revision: source.revision, config: source.config },
      { replacesGrant: true },
    );
  } catch {
    return {
      code: "reconnect-failed",
      message: "The new Google sign-in could not be saved. Try again.",
    };
  }
  return null;
}

/** The source this sign-in completes: the one it renews, or a new one. */
function targetSourceId(session: ConnectorSetupSessionRow): string {
  return session.reconnectDataSourceId ?? crypto.randomUUID();
}

/** Finish a sign-in that renews an existing source's grant. */
async function completeReconnect(
  ctx: HostContext,
  session: ConnectorSetupSessionRow,
  tokenBundle: string,
): Promise<ConnectorSetupSessionDto> {
  const dataSourceId = targetSourceId(session);
  const failure = await renewSourceGrant(ctx, dataSourceId, tokenBundle);
  if (failure) {
    const failed = await failConsumedSession(
      ctx,
      session,
      failure.code,
      failure.message,
    );
    return fullDto(ctx, failed);
  }
  const connected = await markConnected(
    ctx.metadata.connectorSetup,
    session.id,
    dataSourceId,
    new Date(),
    session.stateNonceHash,
  );
  return fullDto(ctx, connected);
}

/** Finish a sign-in that creates a source for the verified grant. */
async function completeNewSource(
  ctx: HostContext,
  session: ConnectorSetupSessionRow,
  verifying: ConnectorSetupSessionRow,
  dataSourceId: string,
  tokenBundle: string,
): Promise<ConnectorSetupSessionDto> {
  try {
    // The host vault consumes plaintext directly; it never enters a draft
    // command log or a public Convex mutation argument.
    const confirmed = await persistVerifiedSource(ctx, {
      id: dataSourceId,
      type: session.connectorId,
      name: session.requestedName,
      apiKey: tokenBundle,
    });
    if (!confirmed) return fullDto(ctx, verifying);
  } catch {
    const failed = await failConsumedSession(
      ctx,
      session,
      "create-failed",
      "The verified connection could not be saved.",
    );
    return fullDto(ctx, failed);
  }

  const connected = await markConnected(
    ctx.metadata.connectorSetup,
    session.id,
    dataSourceId,
    new Date(),
    session.stateNonceHash,
  );
  return fullDto(ctx, connected);
}

export const startConnectorSetup = hostOperation({
  input: z
    .object({
      connectorId: z.string().min(1),
      requestedName: z.string(),
      /** Renew this source's grant in place instead of creating a source. */
      reconnectDataSourceId: z.string().uuid().optional(),
    })
    .strict(),
  userOnly: true,
  run: async (ctx, input): Promise<ConnectorSetupSessionDto> => {
    const descriptor = descriptorFor(ctx, input.connectorId);
    const redirectUri = redirectUriFor(ctx);
    if (input.reconnectDataSourceId) {
      const target = await ctx.metadata.getDataSource(
        input.reconnectDataSourceId,
      );
      if (target?.kind !== descriptor.id) {
        throw new Error("This data source no longer exists.");
      }
    }
    const issuance = await startSession(ctx.metadata.connectorSetup, {
      connectorId: descriptor.id,
      requestedName: input.requestedName.trim() || descriptor.id,
      scopes: descriptor.scopes,
      ...(input.reconnectDataSourceId
        ? { reconnectDataSourceId: input.reconnectDataSourceId }
        : {}),
    });
    const authorizeUrl = descriptor.buildAuthorizeUrl({
      redirectUri,
      state: oauthStateFor(issuance.stateNonce),
      codeVerifier: issuance.session.codeVerifier,
    });
    // Native Convex commits the session before the capability is returned.
    return fullDto(ctx, issuance.session, authorizeUrl);
  },
});

// A query that reads and nothing else. It cannot hand back an authorize URL:
// minting one rotates the state nonce and the PKCE verifier, which is a write,
// and a write hidden inside a query is invisible to callers, retried by any
// transport that assumes queries are safe, and silently invalidates a resume
// link that someone else is mid-flight on. Ask for a fresh URL explicitly
// through `reissueConnectorSetupResume`.
export const getConnectorSetupSession = hostOperation({
  input: z
    .object({
      sessionId: z.string().uuid(),
      publicResume: z.boolean().optional(),
    })
    .strict(),
  userOnly: true,
  run: async (ctx, { sessionId, publicResume }) => {
    const row = await readSession(ctx.metadata.connectorSetup, sessionId);
    return publicResume ? publicDto(row) : fullDto(ctx, row);
  },
});

/** Rotate the resume capability and return a usable authorize URL. */
export const reissueConnectorSetupResume = hostOperation({
  input: z.object({ sessionId: z.string().uuid() }).strict(),
  userOnly: true,
  run: async (ctx, { sessionId }): Promise<PublicConnectorSetupResumeDto> => {
    const issuance = await publicResumeInfo(
      ctx.metadata.connectorSetup,
      sessionId,
      new Date(),
    );
    if (!("stateNonce" in issuance)) {
      return publicDto(issuance.session);
    }
    const authorizeUrl = authorizeUrlFor(ctx, issuance);
    // The nonce rotation has committed before this new URL is returned.
    return publicDto(issuance.session, authorizeUrl);
  },
});

function failConsumedSession(
  ctx: HostContext,
  session: ConnectorSetupSessionRow,
  code: string,
  message: string,
) {
  return markFailed(
    ctx.metadata.connectorSetup,
    session.id,
    code,
    message,
    new Date(),
    ["exchanging", "verifying"],
    session.stateNonceHash,
  );
}

export const completeConnectorOAuth = hostOperation({
  input: z
    .object({
      state: z.string(),
      code: z.string().optional(),
      oauthError: z.string().optional(),
    })
    .strict(),
  userOnly: true,
  run: async (ctx, { state, code, oauthError }) => {
    const consumed = await consumeForCompletion(ctx, state);
    if ("expired" in consumed) return consumed.expired;
    const { session } = consumed;
    if (!hasCompletedAuthorization(oauthError, code)) {
      const failed = await failConsumedSession(
        ctx,
        session,
        "authorization-rejected",
        "Google authorization was not completed.",
      );
      return fullDto(ctx, failed);
    }

    // Check for somewhere to put the credential before spending the
    // authorization code. Without this the flow exchanges the code, probes
    // Google, and only then fails at the create step — reporting
    // "create-failed", which reads as a database problem, and burning a
    // single-use code the user has to redo the whole consent screen to replace.
    if (ctx.vault == null) {
      const failed = await failConsumedSession(
        ctx,
        session,
        "no_vault",
        "This server has no credential vault, so the connection cannot be stored.",
      );
      return fullDto(ctx, failed);
    }

    let descriptor: ReturnType<typeof descriptorFor>;
    let redirectUri: string;
    let tokenBundle: string;
    try {
      descriptor = descriptorFor(ctx, session.connectorId);
      redirectUri = redirectUriFor(ctx);
      tokenBundle = await descriptor.exchangeCode({
        code,
        codeVerifier: session.codeVerifier,
        redirectUri,
        state,
      });
    } catch (error) {
      if (isRedirectUriMismatch(error)) {
        const issuance = await publicResumeInfo(
          ctx.metadata.connectorSetup,
          session.id,
          new Date(),
          true,
          true,
          session.stateNonceHash,
        );
        if (!("stateNonce" in issuance)) {
          return fullDto(ctx, issuance.session);
        }
        return fullDto(ctx, issuance.session, authorizeUrlFor(ctx, issuance));
      }
      const failed = await failConsumedSession(
        ctx,
        session,
        error instanceof OAuthExchangeError ? error.code : "exchange-failed",
        "Google authorization could not be completed.",
      );
      return fullDto(ctx, failed);
    }

    const dataSourceId = targetSourceId(session);
    const verifying = await markVerifying(
      ctx.metadata.connectorSetup,
      session.id,
      dataSourceId,
      new Date(),
      session.stateNonceHash,
    );
    let probe: ReturnType<typeof makeGa4Connector>;
    let properties: Awaited<ReturnType<(typeof probe)["connect"]>>;
    try {
      // Probe against the plaintext bundle in process memory. No vault write or
      // DataSource exists until this authenticated read succeeds.
      probe = makeGa4Connector(async (use) => use(tokenBundle), {
        oauthClient: {
          clientId: googleOAuth(ctx).clientId,
          clientSecret: googleOAuth(ctx).clientSecret,
        },
      });
      properties = await probe.connect();
    } catch {
      const failed = await failConsumedSession(
        ctx,
        session,
        "probe-failed",
        "Google Analytics could not be verified.",
      );
      return fullDto(ctx, failed);
    }

    const unverified = await verifyReportAccess(
      ctx,
      session,
      probe,
      properties,
    );
    if (unverified) {
      const failed = await failConsumedSession(
        ctx,
        session,
        unverified.code,
        unverified.message,
      );
      return fullDto(ctx, failed);
    }

    return session.reconnectDataSourceId
      ? completeReconnect(ctx, session, tokenBundle)
      : completeNewSource(ctx, session, verifying, dataSourceId, tokenBundle);
  },
});

export const cancelConnectorSetup = hostOperation({
  input: z.object({ sessionId: z.string().uuid() }).strict(),
  userOnly: true,
  run: async (ctx, { sessionId }) =>
    fullDto(
      ctx,
      await markFailed(
        ctx.metadata.connectorSetup,
        sessionId,
        "cancelled",
        "Connector setup was cancelled.",
        new Date(),
        ["awaiting-user-auth"],
      ),
    ),
});
export const sweepConnectorSetupSessions = hostOperation({
  input: z.object({}).strict(),
  userOnly: true,
  run: async (ctx) => sweep(ctx.metadata.connectorSetup),
});

export function connectorSetupGateCode(error: unknown): string {
  return error instanceof ConnectorSetupGateError
    ? error.code
    : "callback-failed";
}

export const connectorSetupFunctions = {
  startConnectorSetup,
  getConnectorSetupSession,
  reissueConnectorSetupResume,
  completeConnectorOAuth,
  cancelConnectorSetup,
  sweepConnectorSetupSessions,
};

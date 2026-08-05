import { makeGa4Connector } from "@dashframe/connector-ga4";
import { boolean, text, uuid } from "@wystack/db";

import type { DashframeFunctionContext } from "../app-context";
import {
  OAuthExchangeError,
  connectorResumeLink,
  oauthConnectorDescriptorFor,
  resolveOAuthRedirectUri,
} from "../connector-setup/oauth-provider";
import {
  ConnectorSetupGateError,
  consumeCallback,
  markConnected,
  markFailed,
  markVerifying,
  oauthStateFor,
  publicResumeInfo,
  startSession,
  sweep,
  type ConnectorSetupSessionRow,
  type ConnectorSetupState,
  type SessionIssuance,
} from "../connector-setup/session-store";
import { permissions } from "../permissions";
import { wy } from "../wystack";
import { COMMAND_PATHS } from "./commands";

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

function googleOAuth(ctx: DashframeFunctionContext) {
  if (!ctx.googleOAuth) {
    throw new Error("Google Analytics OAuth is not configured");
  }
  return ctx.googleOAuth;
}

function descriptorFor(ctx: DashframeFunctionContext, connectorId: string) {
  return oauthConnectorDescriptorFor(connectorId, googleOAuth(ctx));
}

function redirectUriFor(ctx: DashframeFunctionContext): string {
  return resolveOAuthRedirectUri(
    ctx.getServerEndpoint(),
    googleOAuth(ctx).redirectBase,
  );
}

function authorizeUrlFor(
  ctx: DashframeFunctionContext,
  issuance: SessionIssuance,
): string {
  const descriptor = descriptorFor(ctx, issuance.session.connectorId);
  return descriptor.buildAuthorizeUrl({
    redirectUri: redirectUriFor(ctx),
    state: oauthStateFor(issuance.stateNonce),
    codeVerifier: issuance.session.codeVerifier,
  });
}

function fullDto(
  ctx: DashframeFunctionContext,
  row: ConnectorSetupSessionRow,
  authorizeUrl?: string,
): ConnectorSetupSessionDto {
  return {
    sessionId: row.id,
    connectorId: row.connectorId,
    requestedName: row.requestedName,
    state: row.state as ConnectorSetupState,
    ...(authorizeUrl ? { authorizeUrl } : {}),
    resumeUrl: connectorResumeLink(ctx.getServerEndpoint(), row.id),
    ...(row.dataSourceId ? { dataSourceId: row.dataSourceId } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
    ...(row.failureMessage ? { failureMessage: row.failureMessage } : {}),
    expiresAt: row.expiresAt.getTime(),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function publicDto(
  row: ConnectorSetupSessionRow,
  authorizeUrl?: string,
): PublicConnectorSetupResumeDto {
  const state =
    row.state === "connected" ||
    row.state === "failed" ||
    row.state === "expired"
      ? row.state
      : "awaiting-user-auth";
  return {
    sessionId: row.id,
    connectorId: row.connectorId,
    state,
    ...(state === "awaiting-user-auth" && authorizeUrl ? { authorizeUrl } : {}),
    expiresAt: row.expiresAt.getTime(),
  };
}

async function requireDurableFlush(
  ctx: DashframeFunctionContext,
  label: string,
): Promise<void> {
  if (!ctx.flushSnapshot) {
    throw new Error(`${label} requires durable project snapshots`);
  }
  await ctx.flushSnapshot();
}

async function consumeForCompletion(
  ctx: DashframeFunctionContext,
  state: string,
): Promise<
  { session: ConnectorSetupSessionRow } | { expired: ConnectorSetupSessionDto }
> {
  try {
    return { session: await consumeCallback(ctx.db, state) };
  } catch (error) {
    if (
      error instanceof ConnectorSetupGateError &&
      error.code === "session-expired" &&
      error.session
    ) {
      // The expiry update must leave the procedure normally so app.call can
      // run its write/snapshot/invalidation hooks before the route reports a
      // generic callback rejection.
      await requireDurableFlush(ctx, "completeConnectorOAuth");
      return { expired: fullDto(ctx, error.session) };
    }
    throw error;
  }
}

const startConnectorSetup = wy.procedure
  .authorize(permissions.connectors.setup)
  .input({ connectorId: text, requestedName: text })
  .mutation(async (ctx, input): Promise<ConnectorSetupSessionDto> => {
    const descriptor = descriptorFor(ctx, input.connectorId);
    const redirectUri = redirectUriFor(ctx);
    const issuance = await startSession(ctx.db, {
      connectorId: descriptor.id,
      requestedName: input.requestedName.trim() || descriptor.id,
      scopes: descriptor.scopes,
    });
    const authorizeUrl = descriptor.buildAuthorizeUrl({
      redirectUri,
      state: oauthStateFor(issuance.stateNonce),
      codeVerifier: issuance.session.codeVerifier,
    });
    // A resume capability without its row is permanently dead. Do not return it
    // until the snapshot containing the INSERT is durable.
    await requireDurableFlush(ctx, "startConnectorSetup");
    return fullDto(ctx, issuance.session, authorizeUrl);
  });

const getConnectorSetupSession = wy.procedure
  .authorize(permissions.connectors.setup)
  .input({ sessionId: uuid, publicResume: boolean.optional() })
  .query(async (ctx, { sessionId, publicResume }) => {
    const issuance = await publicResumeInfo(
      ctx.db,
      sessionId,
      new Date(),
      publicResume === true,
    );
    const authorizeUrl =
      "stateNonce" in issuance ? authorizeUrlFor(ctx, issuance) : undefined;
    if ("stateNonce" in issuance) {
      await requireDurableFlush(ctx, "getConnectorSetupSession");
    }
    return publicResume
      ? publicDto(issuance.session, authorizeUrl)
      : fullDto(ctx, issuance.session, authorizeUrl);
  });

const completeConnectorOAuth = wy.procedure
  .authorize(permissions.connectors.setup)
  .input({ state: text, code: text.optional(), oauthError: text.optional() })
  .mutation(async (ctx, { state, code, oauthError }) => {
    const consumed = await consumeForCompletion(ctx, state);
    if ("expired" in consumed) return consumed.expired;
    const { session } = consumed;
    if (oauthError || !code) {
      const failed = await markFailed(
        ctx.db,
        session.id,
        "authorization-rejected",
        "Google authorization was not completed.",
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
      if (error instanceof OAuthExchangeError && error.redirectUriMismatch) {
        const issuance = await publicResumeInfo(
          ctx.db,
          session.id,
          new Date(),
          true,
          true,
        );
        if (!("stateNonce" in issuance)) {
          return fullDto(ctx, issuance.session);
        }
        await requireDurableFlush(ctx, "completeConnectorOAuth");
        return fullDto(ctx, issuance.session, authorizeUrlFor(ctx, issuance));
      }
      const failed = await markFailed(
        ctx.db,
        session.id,
        error instanceof OAuthExchangeError ? error.code : "exchange-failed",
        "Google authorization could not be completed.",
      );
      return fullDto(ctx, failed);
    }

    const dataSourceId = crypto.randomUUID();
    await markVerifying(ctx.db, session.id, dataSourceId);
    try {
      // Probe against the plaintext bundle in process memory. No vault write or
      // DataSource exists until this authenticated read succeeds.
      const probe = makeGa4Connector(async (use) => use(tokenBundle));
      await probe.connect();
    } catch {
      const failed = await markFailed(
        ctx.db,
        session.id,
        "probe-failed",
        "Google Analytics could not be verified.",
      );
      return fullDto(ctx, failed);
    }

    const app = ctx.wyStackApp;
    if (!app) throw new Error("Connector setup app context is unavailable");
    try {
      // Direct canonical command call only. Never pass mode: "preview": the
      // plaintext token bundle must go straight to storeCredential and can
      // never enter proposedDefinition or a draft command log.
      await app.call(
        COMMAND_PATHS.CreateDataSource,
        {
          id: dataSourceId,
          type: session.connectorId,
          name: session.requestedName,
          apiKey: tokenBundle,
        },
        { principal: ctx.principal },
      );
    } catch {
      const failed = await markFailed(
        ctx.db,
        session.id,
        "create-failed",
        "The verified connection could not be saved.",
      );
      return fullDto(ctx, failed);
    }

    const connected = await markConnected(ctx.db, session.id, dataSourceId);
    await requireDurableFlush(ctx, "completeConnectorOAuth");
    return fullDto(ctx, connected);
  });

const cancelConnectorSetup = wy.procedure
  .authorize(permissions.connectors.setup)
  .input({ sessionId: uuid })
  .mutation(async (ctx, { sessionId }) =>
    fullDto(
      ctx,
      await markFailed(
        ctx.db,
        sessionId,
        "cancelled",
        "Connector setup was cancelled.",
        new Date(),
        ["awaiting-user-auth"],
      ),
    ),
  );

const sweepConnectorSetupSessions = wy.procedure
  .authorize(permissions.connectors.setup)
  .input({})
  .mutation(async (ctx) => sweep(ctx.db));

export function connectorSetupGateCode(error: unknown): string {
  return error instanceof ConnectorSetupGateError
    ? error.code
    : "callback-failed";
}

export const connectorSetupFunctions = {
  startConnectorSetup,
  getConnectorSetupSession,
  completeConnectorOAuth,
  cancelConnectorSetup,
  sweepConnectorSetupSessions,
};

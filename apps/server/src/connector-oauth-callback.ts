import type { WyStackApp } from "@wystack/server";
import type { Context } from "hono";

import type {
  ConnectorSetupSessionDto,
  PublicConnectorSetupResumeDto,
} from "./functions/connector-setup";
import { connectorSetupGateCode } from "./functions/connector-setup";
import { LOCAL_USER_ID } from "./permissions";

const INTERNAL_PRINCIPAL = {
  kind: "user" as const,
  userId: LOCAL_USER_ID,
};

function secureHtml(c: Context, title: string, message: string, status = 200) {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  );
  return c.html(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${title}</title><style>body{font:16px system-ui;max-width:36rem;margin:12vh auto;padding:0 1.5rem;color:#171717}h1{font-size:1.5rem}</style></head><body><h1>${title}</h1><p>${message}</p></body></html>`,
    status as 200,
  );
}

export async function handleConnectorOAuthCallback(
  c: Context,
  app: WyStackApp,
) {
  const state = c.req.query("state") ?? "";
  const code = c.req.query("code");
  const oauthError = c.req.query("error");
  try {
    const call = await app.call(
      "completeConnectorOAuth",
      { state, code, oauthError },
      // Fixed server-owned identity. No callback query/header value can select
      // or alter the principal used for the project mutation.
      { principal: INTERNAL_PRINCIPAL },
    );
    const result = call.result as ConnectorSetupSessionDto;
    if (result.state === "connected") {
      return secureHtml(
        c,
        "Google Analytics connected",
        "You can close this window and return to DashFrame.",
      );
    }
    if (result.state === "awaiting-user-auth") {
      return secureHtml(
        c,
        "Authorization needs to restart",
        "Return to DashFrame and use the original resume link to sign in again.",
        409,
      );
    }
    if (result.state === "expired") {
      console.warn(
        "[dashframe] connector OAuth callback rejected: session-expired",
      );
    }
    return secureHtml(
      c,
      "Connection could not be completed",
      "Return to DashFrame to review the setup status.",
      400,
    );
  } catch (error) {
    // Never log the request URL, state, code, or session id.
    console.warn(
      `[dashframe] connector OAuth callback rejected: ${connectorSetupGateCode(error)}`,
    );
    return secureHtml(
      c,
      "Connection could not be completed",
      "Return to DashFrame and start connector setup again.",
      400,
    );
  }
}

export async function handleConnectorSetupResume(c: Context, app: WyStackApp) {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  try {
    // Resuming means handing back a working authorize URL, which rotates the
    // state nonce. That is a write, so this calls the mutation rather than the
    // read-only query.
    const call = await app.call(
      "reissueConnectorSetupResume",
      { sessionId: c.req.param("sessionId") },
      { principal: INTERNAL_PRINCIPAL },
    );
    return c.json(call.result as PublicConnectorSetupResumeDto);
  } catch {
    return c.json({ error: "Connector setup session is unavailable" }, 404);
  }
}

export async function handleConnectorResumeLanding(
  c: Context,
  app: WyStackApp,
) {
  const sessionId = c.req.query("resumeConnector");
  if (!sessionId) {
    return secureHtml(c, "DashFrame", "Open DashFrame to continue.", 404);
  }

  try {
    const call = await app.call(
      "reissueConnectorSetupResume",
      { sessionId },
      { principal: INTERNAL_PRINCIPAL },
    );
    const result = call.result as PublicConnectorSetupResumeDto;
    if (result.state === "awaiting-user-auth" && result.authorizeUrl) {
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      return c.redirect(result.authorizeUrl);
    }
    if (result.state === "connected") {
      return secureHtml(
        c,
        "Google Analytics connected",
        "This setup is already complete. You can close this window.",
      );
    }
    return secureHtml(
      c,
      "Connector setup unavailable",
      "Return to DashFrame and start connector setup again.",
      410,
    );
  } catch {
    return secureHtml(
      c,
      "Connector setup unavailable",
      "Return to DashFrame and start connector setup again.",
      404,
    );
  }
}

import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ConvexError } from "convex/values";
import { createMcpRoute } from "../mcp/route";
import type {
  HostedCredentialTokenSource,
  HostedPrincipalTokenSource,
} from "./hosted-token-issuer";
import type { createHostedServiceAccess } from "./hosted-service-access";
import type { createHostedWorkspaceResourceFactory } from "./hosted-workspace-resources";
import type { WithPrincipalContext } from "./hosted-route-context";
import type { HostedAdmission } from "./hosted-admission-service";
import type { HostedAgentGrants } from "./hosted-agent-grants";
import {
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  type AgentTokenVerifier,
  type HostedMcpOAuthConfig,
  type VerifiedAgentToken,
} from "./hosted-mcp-oauth";

export const MAX_HOSTED_MCP_BODY_BYTES = 1024 * 1024;
const MAX_CACHED_AGENT_BINDINGS = 1024;
const SERVICE_TOKEN_LIFETIME_MS = 60_000;

export interface HostedMcpOAuthOptions {
  config: HostedMcpOAuthConfig;
  verifier: AgentTokenVerifier;
  admission: {
    resolve(user: {
      userId: string;
      expiresAt: number;
    }): Promise<HostedAdmission>;
  };
  grants: Pick<HostedAgentGrants, "ensure">;
}

export function mountHostedMcpRoutes(
  app: Hono,
  options: {
    publicOrigin: string;
    authenticateCredential?: Awaited<
      ReturnType<typeof createHostedWorkspaceResourceFactory>
    >["authenticateCredential"];
    serviceAccess: Pick<
      ReturnType<typeof createHostedServiceAccess>,
      "resolve"
    >;
    withPrincipalContext: WithPrincipalContext;
    /** AuthKit OAuth for the universal /mcp endpoint; absent means it is off. */
    oauth?: HostedMcpOAuthOptions;
  },
) {
  const {
    publicOrigin,
    authenticateCredential,
    serviceAccess,
    withPrincipalContext,
    oauth,
  } = options;

  /** Bind a host-verified service source to its owner, then run stateless MCP. */
  async function serveAsService(
    c: Context,
    workspaceId: string,
    source: HostedPrincipalTokenSource & HostedCredentialTokenSource,
    unauthorized: () => Response,
  ) {
    let ownerId: string;
    try {
      const binding = await serviceAccess.resolve(workspaceId, source);
      if (
        binding.workspaceId !== workspaceId ||
        binding.credentialId !== source.credentialId
      )
        return unauthorized();
      ownerId = binding.subject;
    } catch (error) {
      // Convex denials (revoked, unowned, unadmitted) are auth failures; a
      // transport fault is our outage and must not trigger re-authorization.
      if (error instanceof ConvexError) return unauthorized();
      return c.json({ error: "Agent request unavailable" }, 503);
    }
    try {
      return await withPrincipalContext(
        workspaceId,
        ownerId,
        source,
        c.req.raw,
        async (hosted, signal) => {
          const mcp = new Hono();
          mcp.all(
            "*",
            createMcpRoute({
              app: hosted.application,
              mode: "stateless",
              resolveContext: async () => ({
                principal: hosted.context.principal,
              }),
            }),
          );
          return mcp.fetch(new Request(c.req.raw, { signal }));
        },
      );
    } catch {
      return c.json({ error: "Agent request unavailable" }, 503);
    }
  }

  app.use(
    "/workspaces/:workspaceId/mcp",
    bodyLimit({ maxSize: MAX_HOSTED_MCP_BODY_BYTES }),
  );
  app.all("/workspaces/:workspaceId/mcp", async (c) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("Origin");
    if (origin && origin !== publicOrigin)
      return c.json({ error: "Origin is not allowed" }, 403);
    const bearer = /^Bearer (dfa_[a-z0-9_-]+)$/i.exec(
      c.req.header("Authorization") ?? "",
    );
    const unauthorized = () =>
      c.json({ error: "Unauthorized MCP request" }, 401);
    if (!bearer) return unauthorized();
    if (!authenticateCredential)
      return c.json({ error: "Agent access unavailable" }, 503);
    const workspaceId = c.req.param("workspaceId");
    let credentialId: string | null;
    try {
      credentialId = await authenticateCredential(workspaceId, bearer[1]!);
    } catch {
      return unauthorized();
    }
    if (!credentialId) return unauthorized();
    return serveAsService(
      c,
      workspaceId,
      {
        kind: "service",
        credentialId,
        expiresAt: Date.now() + SERVICE_TOKEN_LIFETIME_MS,
      },
      unauthorized,
    );
  });

  mountUniversalMcpRoute(app, publicOrigin, oauth, serveAsService);
}

/** Cached (subject, client, iat) → workspace and grant, valid until the access token expires. */
type AgentBinding = { workspaceId: string; grantId: string; expiresAt: number };

/** Resolve a verified token's subject to its admitted workspace and agent grant. */
async function bindAgent(
  oauth: HostedMcpOAuthOptions,
  token: VerifiedAgentToken,
): Promise<
  AgentBinding | "unavailable" | "pending" | "admission revoked" | "revoked"
> {
  const user = { userId: token.subject, expiresAt: token.expiresAt };
  let admission: HostedAdmission;
  try {
    admission = await oauth.admission.resolve(user);
  } catch {
    return "unavailable";
  }
  if (admission.status !== "admitted")
    return admission.status === "pending" ? "pending" : "admission revoked";
  try {
    const grant = await oauth.grants.ensure(
      user,
      admission.workspaceId,
      token.clientKey,
    );
    // Revocation is final until the owner explicitly reconnects this client.
    if (grant.status === "revoked") return "revoked";
    return {
      workspaceId: admission.workspaceId,
      grantId: grant.grantId,
      expiresAt: token.expiresAt,
    };
  } catch {
    return "unavailable";
  }
}

function mountUniversalMcpRoute(
  app: Hono,
  publicOrigin: string,
  oauth: HostedMcpOAuthOptions | undefined,
  serveAsService: (
    c: Context,
    workspaceId: string,
    source: HostedPrincipalTokenSource & HostedCredentialTokenSource,
    unauthorized: () => Response,
  ) => Promise<Response>,
) {
  const metadataPaths = [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ];
  for (const path of metadataPaths)
    app.get(path, (c) => {
      if (!oauth) return c.json({ error: "Not found" }, 404);
      c.header("Cache-Control", "public, max-age=300");
      return c.json(protectedResourceMetadata(oauth.config));
    });

  // Admission and grant lookups are re-checked by serviceAccess on every
  // request, so caching them only skips the two writes-or-reads before it.
  const bindings = new Map<string, AgentBinding>();
  function remember(key: string, binding: AgentBinding) {
    const now = Date.now();
    if (bindings.size >= MAX_CACHED_AGENT_BINDINGS)
      for (const [cached, value] of bindings)
        if (
          value.expiresAt <= now ||
          bindings.size >= MAX_CACHED_AGENT_BINDINGS
        )
          bindings.delete(cached);
    bindings.set(key, binding);
  }

  /** Cached binding for this token, or the response that refuses it. */
  async function binding(
    c: Context,
    oauth: HostedMcpOAuthOptions,
    key: string,
    token: VerifiedAgentToken,
    unauthorized: (invalid?: boolean) => Response,
  ): Promise<AgentBinding | Response> {
    const cached = bindings.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached;
    bindings.delete(key);
    const bound = await bindAgent(oauth, token);
    if (typeof bound === "object") {
      remember(key, bound);
      return bound;
    }
    // Final revocation: a 401 would only send the client back through sign-in,
    // which maps to the same revoked grant, so end the flow with a 403.
    if (bound === "revoked")
      return c.json(
        { error: "This agent's access to DashFrame was revoked" },
        403,
      );
    if (bound === "unavailable")
      return c.json({ error: "Agent sign-in unavailable" }, 503);
    return c.json({ error: ADMISSION_REFUSALS[bound] }, 403);
  }

  app.use("/mcp", bodyLimit({ maxSize: MAX_HOSTED_MCP_BODY_BYTES }));
  app.all("/mcp", async (c) => {
    c.header("Cache-Control", "no-store");
    if (!oauth) return c.json({ error: "Agent sign-in unavailable" }, 503);
    const origin = c.req.header("Origin");
    if (origin && origin !== publicOrigin)
      return c.json({ error: "Origin is not allowed" }, 403);
    const unauthorized = challenge(c, oauth.config);
    const token = await verifiedToken(c, oauth, unauthorized);
    if (token instanceof Response) return token;
    const key = `${token.subject}\n${token.clientKey}\n${token.issuedAt}`;
    const bound = await binding(c, oauth, key, token, unauthorized);
    if (bound instanceof Response) return bound;
    return serveAsService(
      c,
      bound.workspaceId,
      {
        kind: "service",
        credentialId: bound.grantId,
        expiresAt: Math.min(
          token.expiresAt,
          Date.now() + SERVICE_TOKEN_LIFETIME_MS,
        ),
      },
      () => {
        // The grant was revoked or its owner lost admission after caching.
        bindings.delete(key);
        return unauthorized(true);
      },
    );
  });
}

const ADMISSION_REFUSALS = {
  pending: "This account is waiting for DashFrame access",
  "admission revoked": "This account's DashFrame access was revoked",
} as const;

/** A 401 whose challenge points at the protected resource metadata. */
function challenge(c: Context, config: HostedMcpOAuthConfig) {
  const metadataUrl = protectedResourceMetadataUrl(config);
  return (invalid = false) => {
    c.header(
      "WWW-Authenticate",
      invalid
        ? `Bearer resource_metadata="${metadataUrl}", error="invalid_token"`
        : `Bearer resource_metadata="${metadataUrl}"`,
    );
    return c.json({ error: "Unauthorized MCP request" }, 401);
  };
}

async function verifiedToken(
  c: Context,
  oauth: HostedMcpOAuthOptions,
  unauthorized: (invalid?: boolean) => Response,
): Promise<VerifiedAgentToken | Response> {
  const bearer = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(
    c.req.header("Authorization") ?? "",
  );
  if (!bearer) return unauthorized();
  const verified = await oauth.verifier.verify(bearer[1]!);
  if (!verified.ok)
    return verified.reason === "unavailable"
      ? c.json({ error: "Agent sign-in unavailable" }, 503)
      : unauthorized(true);
  // jwtVerify allows clock skew; a token this close to expiry cannot sign anything.
  if (verified.token.expiresAt <= Date.now() + 1_000) return unauthorized(true);
  return verified.token;
}

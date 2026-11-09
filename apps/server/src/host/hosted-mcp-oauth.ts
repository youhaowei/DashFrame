import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

/** A verified AuthKit access token, reduced to what the MCP route needs. */
export interface VerifiedAgentToken {
  /** WorkOS user ID: the same subject hosted admission is keyed by. */
  subject: string;
  /** Stable OAuth client identity; one agent grant exists per subject and client. */
  clientKey: string;
  /** Token `iat`, in Unix seconds. */
  issuedAt: number;
  /** Token `exp`, in Unix milliseconds. */
  expiresAt: number;
}

export type AgentTokenVerification =
  | { ok: true; token: VerifiedAgentToken }
  | { ok: false; reason: "invalid" | "unavailable" };

export interface AgentTokenVerifier {
  verify(token: string): Promise<AgentTokenVerification>;
}

export interface HostedMcpOAuthConfig {
  /** AuthKit issuer, exactly as it appears in the access token's `iss`. */
  issuer: string;
  /** This server's MCP URL; AuthKit issues `aud` equal to it. */
  resource: string;
}

const MAX_SUBJECT_LENGTH = 256;
const MAX_CLIENT_LENGTH = 400;

/** Read the optional AuthKit issuer; without it the universal /mcp endpoint stays off. */
export function readHostedMcpOAuthConfig(
  environment: Record<string, string | undefined>,
  publicOrigin: string,
): HostedMcpOAuthConfig | undefined {
  const issuer = environment.DASHFRAME_MCP_OAUTH_ISSUER;
  if (!issuer) return undefined;
  return {
    issuer: validateHttpsUrl(issuer, "MCP OAuth issuer"),
    resource: `${validateHttpsUrl(publicOrigin, "public origin").replace(/\/$/, "")}/mcp`,
  };
}

/**
 * Verifies AuthKit-issued MCP access tokens against the issuer's JWKS. The
 * audience must be this server's MCP URL, so a token AuthKit issued for any
 * other resource is refused.
 */
export function createAuthKitAccessTokenVerifier(
  config: HostedMcpOAuthConfig,
  keys: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(`${config.issuer.replace(/\/$/, "")}/oauth2/jwks`),
    { timeoutDuration: 5_000, cooldownDuration: 30_000 },
  ),
): AgentTokenVerifier {
  return {
    async verify(token) {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          issuer: config.issuer,
          audience: config.resource,
          algorithms: ["RS256"],
          requiredClaims: ["sub", "iat", "exp"],
          clockTolerance: 30,
        }));
      } catch (error) {
        return {
          ok: false,
          reason: unavailable(error) ? "unavailable" : "invalid",
        };
      }
      const subject = payload.sub;
      const client = clientClaim(payload);
      if (
        !boundedIdentifier(subject, MAX_SUBJECT_LENGTH) ||
        (client !== undefined &&
          !boundedIdentifier(client, MAX_CLIENT_LENGTH)) ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number"
      )
        return { ok: false, reason: "invalid" };
      return {
        ok: true,
        token: {
          subject: subject as string,
          // AuthKit may omit a client claim; one grant per subject is the safe fallback.
          clientKey: client === undefined ? "oauth" : `oauth:${client}`,
          issuedAt: payload.iat,
          expiresAt: payload.exp * 1000,
        },
      };
    },
  };
}

/** RFC 9728 protected resource metadata for the universal MCP endpoint. */
export function protectedResourceMetadata(config: HostedMcpOAuthConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    resource_name: "DashFrame",
  };
}

export function protectedResourceMetadataUrl(config: HostedMcpOAuthConfig) {
  const resource = new URL(config.resource);
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
}

/** AuthKit names the OAuth client in `client_id`; OIDC-style tokens use `azp`. */
function clientClaim(payload: JWTPayload): unknown {
  if (payload.client_id !== undefined) return payload.client_id;
  return payload.azp;
}

const TOKEN_ERRORS = [
  joseErrors.JWTClaimValidationFailed,
  joseErrors.JWTExpired,
  joseErrors.JWTInvalid,
  joseErrors.JWSInvalid,
  joseErrors.JWSSignatureVerificationFailed,
  joseErrors.JOSEAlgNotAllowed,
  joseErrors.JOSENotSupported,
  joseErrors.JWKSNoMatchingKey,
  joseErrors.JWKSMultipleMatchingKeys,
];

function unavailable(error: unknown) {
  // Only a fault in the token itself earns a 401. Key-fetch failures are our
  // outage, and a 401 would push every connected client into re-authorization.
  return !TOKEN_ERRORS.some((type) => error instanceof type);
}

function boundedIdentifier(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\s\p{Cc}]/u.test(value)
  );
}

function validateHttpsUrl(value: string, name: string) {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol === "https:" &&
      parsed.hostname &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      value.trim() === value
    )
      return value;
  } catch {
    // Fall through to the configuration error below.
  }
  throw new Error(`Invalid ${name}`);
}

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
} from "node:crypto";

const AUDIENCE = "dashframe";
const TOKEN_LIFETIME_SECONDS = 60;

export interface HostedUserTokenSource {
  userId: string;
  /** Expiry of the already-verified caller session, in Unix milliseconds. */
  expiresAt: number;
}

export interface HostedCredentialTokenSource {
  credentialId: string;
  /** Expiry of the already-verified caller credential, in Unix milliseconds. */
  expiresAt: number;
}

export type HostedPrincipalTokenSource =
  | ({ kind: "user" } & HostedUserTokenSource)
  | ({ kind: "service" } & HostedCredentialTokenSource);

export interface HostedTokenIssuerOptions {
  /** Exact HTTPS issuer configured as the deployment's trusted runtime issuer. */
  issuer: string;
  /** Existing RSA private key. This helper never creates or persists key material. */
  privateKey: string | Buffer | KeyObject;
}

export interface IssuedHostedToken {
  token: string;
  /** Effective JWT expiry in Unix milliseconds. */
  expiresAt: number;
}

type TokenClaims = {
  sub: string;
  principalKind: "user" | "service";
  userId?: string;
  credentialId?: string;
  workspaceId?: string;
  authority: "browser" | "service" | "host";
  purpose?: "host-metadata" | "host-credentials";
};

/**
 * Signs hosted runtime JWT shapes from explicitly supplied deployment authority.
 * Callers must first verify the source identity, its current expiry and admission.
 * Host-purpose methods must remain on server-only paths. This helper does not
 * verify identity or admission and does not configure a provider's trust.
 */
export function createHostedTokenIssuer(options: HostedTokenIssuerOptions) {
  const issuer = validateIssuer(options.issuer);
  const privateKey = validatePrivateKey(options.privateKey);
  const publicKey = createPublicKey(privateKey);
  const kid = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url");
  const jwk = publicKey.export({ format: "jwk" });
  const jwks = {
    keys: [{ ...jwk, kid, alg: "RS256" as const, use: "sig" as const }],
  };
  const jwksDataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`;

  function issue(
    claims: TokenClaims,
    sourceExpiresAt: number,
  ): IssuedHostedToken {
    const now = Date.now();
    const issuedAt = Math.floor(now / 1000);
    const expiresAt = validateExpiry(sourceExpiresAt, now, issuedAt);
    const header = encode({ alg: "RS256", typ: "JWT", kid });
    const payload = encode({
      iss: issuer,
      aud: AUDIENCE,
      ...claims,
      iat: issuedAt,
      exp: expiresAt / 1000,
    });
    const input = `${header}.${payload}`;
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(input),
      privateKey,
    ).toString("base64url");
    return { token: `${input}.${signature}`, expiresAt };
  }

  return {
    issuer,
    audience: AUDIENCE as "dashframe",
    jwks,
    jwksDataUri,
    admission(user: HostedUserTokenSource) {
      const userId = identifier(user.userId, "user ID");
      return issue(
        {
          sub: `user:${userId}`,
          principalKind: "user",
          userId,
          authority: "host",
        },
        user.expiresAt,
      );
    },
    browser(user: HostedUserTokenSource, workspaceId: string) {
      const userId = identifier(user.userId, "user ID");
      return issue(
        {
          sub: `user:${userId}`,
          principalKind: "user",
          userId,
          workspaceId: identifier(workspaceId, "workspace ID"),
          authority: "browser",
        },
        user.expiresAt,
      );
    },
    service(credential: HostedCredentialTokenSource, workspaceId: string) {
      const credentialId = identifier(credential.credentialId, "credential ID");
      return issue(
        {
          sub: `service:${credentialId}`,
          principalKind: "service",
          credentialId,
          workspaceId: identifier(workspaceId, "workspace ID"),
          authority: "service",
        },
        credential.expiresAt,
      );
    },
    metadata(principal: HostedPrincipalTokenSource, workspaceId: string) {
      return issue(
        principalClaims(principal, workspaceId, "host-metadata"),
        principal.expiresAt,
      );
    },
    credentialOwnership(user: HostedUserTokenSource, workspaceId: string) {
      const userId = identifier(user.userId, "user ID");
      return issue(
        {
          sub: `user:${userId}`,
          principalKind: "user",
          userId,
          workspaceId: identifier(workspaceId, "workspace ID"),
          authority: "host",
          purpose: "host-credentials",
        },
        user.expiresAt,
      );
    },
  };
}

export type HostedTokenIssuer = ReturnType<typeof createHostedTokenIssuer>;

function principalClaims(
  principal: HostedPrincipalTokenSource,
  workspaceId: string,
  purpose: "host-metadata",
): TokenClaims {
  const scope = identifier(workspaceId, "workspace ID");
  if (principal.kind === "user") {
    const userId = identifier(principal.userId, "user ID");
    return {
      sub: `user:${userId}`,
      principalKind: "user",
      userId,
      workspaceId: scope,
      authority: "host",
      purpose,
    };
  }
  const credentialId = identifier(principal.credentialId, "credential ID");
  return {
    sub: `service:${credentialId}`,
    principalKind: "service",
    credentialId,
    workspaceId: scope,
    authority: "host",
    purpose,
  };
}

function validateIssuer(value: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value)
    throw new Error("Invalid hosted token issuer");
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error();
  } catch {
    throw new Error("Invalid hosted token issuer");
  }
  return value;
}

function validatePrivateKey(value: string | Buffer | KeyObject): KeyObject {
  try {
    const key = value instanceof KeyObject ? value : createPrivateKey(value);
    if (
      key.type !== "private" ||
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      throw new Error();
    return key;
  } catch {
    throw new Error("Invalid hosted RSA private key");
  }
}

function identifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    /[\s\p{Cc}]/u.test(value)
  )
    throw new Error(`Invalid ${name}`);
  return value;
}

function validateExpiry(value: unknown, now: number, issuedAt: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= now)
    throw new Error("Verified source expiry is invalid or expired");
  const expiration = Math.min(
    issuedAt + TOKEN_LIFETIME_SECONDS,
    Math.floor(value / 1000),
  );
  if (expiration <= issuedAt)
    throw new Error("Verified source expiry is invalid or expired");
  return expiration * 1000;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

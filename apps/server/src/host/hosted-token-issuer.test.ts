import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createHostedTokenIssuer } from "./hosted-token-issuer";

const issuerUrl = "https://runtime.example.test/auth";

function key(modulusLength = 2048) {
  return generateKeyPairSync("rsa", { modulusLength }).privateKey;
}

function decode(token: string) {
  const [header, payload, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString()) as Record<
      string,
      unknown
    >,
    claims: JSON.parse(Buffer.from(payload!, "base64url").toString()) as Record<
      string,
      unknown
    >,
    input: `${header}.${payload}`,
    signature: signature!,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("hosted token issuer", () => {
  it("signs every named runtime authority with the supplied RSA key and exact claims", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const privateKey = key();
    const tokens = createHostedTokenIssuer({
      issuer: issuerUrl,
      privateKey,
    });
    const sourceExpiry = 1_120_000;
    const issued = [
      tokens.admission({ userId: "user-a", expiresAt: sourceExpiry }),
      tokens.browser(
        { userId: "user-a", expiresAt: sourceExpiry },
        "workspace-a",
      ),
      tokens.service(
        { credentialId: "credential-a", expiresAt: sourceExpiry },
        "workspace-a",
      ),
      tokens.metadata(
        { kind: "user", userId: "user-a", expiresAt: sourceExpiry },
        "workspace-a",
      ),
      tokens.metadata(
        {
          kind: "service",
          credentialId: "credential-a",
          expiresAt: sourceExpiry,
        },
        "workspace-a",
      ),
      tokens.credentialOwnership(
        { userId: "user-a", expiresAt: sourceExpiry },
        "workspace-a",
      ),
    ];
    const expectedClaims = [
      {
        sub: "user:user-a",
        principalKind: "user",
        userId: "user-a",
        authority: "host",
      },
      {
        sub: "user:user-a",
        principalKind: "user",
        userId: "user-a",
        workspaceId: "workspace-a",
        authority: "browser",
      },
      {
        sub: "service:credential-a",
        principalKind: "service",
        credentialId: "credential-a",
        workspaceId: "workspace-a",
        authority: "service",
      },
      {
        sub: "user:user-a",
        principalKind: "user",
        userId: "user-a",
        workspaceId: "workspace-a",
        authority: "host",
        purpose: "host-metadata",
      },
      {
        sub: "service:credential-a",
        principalKind: "service",
        credentialId: "credential-a",
        workspaceId: "workspace-a",
        authority: "host",
        purpose: "host-metadata",
      },
      {
        sub: "user:user-a",
        principalKind: "user",
        userId: "user-a",
        workspaceId: "workspace-a",
        authority: "host",
        purpose: "host-credentials",
      },
    ];
    const publicJwk = tokens.jwks.keys[0]!;
    expect(publicJwk).not.toHaveProperty("d");
    expect(publicJwk).not.toHaveProperty("p");
    expect(tokens.jwksDataUri).not.toContain("PRIVATE");
    const publicKey = createPublicKey({ key: publicJwk, format: "jwk" });
    for (const [index, result] of issued.entries()) {
      const decoded = decode(result.token);
      expect(decoded.header).toEqual({
        alg: "RS256",
        typ: "JWT",
        kid: publicJwk.kid,
      });
      expect(decoded.claims).toEqual({
        iss: issuerUrl,
        aud: "dashframe",
        ...expectedClaims[index],
        iat: 1000,
        exp: 1060,
      });
      expect(result.expiresAt).toBe(1_060_000);
      expect(
        verify(
          "RSA-SHA256",
          Buffer.from(decoded.input),
          publicKey,
          Buffer.from(decoded.signature, "base64url"),
        ),
      ).toBe(true);
    }
    expect(expectedClaims[0]).not.toHaveProperty("workspaceId");
    expect(
      expectedClaims.slice(0, 3).every((claims) => !("purpose" in claims)),
    ).toBe(true);
  });

  it("caps expiry at the verified source and rejects expired or non-finite times", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const tokens = createHostedTokenIssuer({
      issuer: issuerUrl,
      privateKey: key(),
    });
    const issued = tokens.browser(
      { userId: "user-a", expiresAt: 1_025_900 },
      "workspace-a",
    );
    expect(decode(issued.token).claims.exp).toBe(1025);
    expect(issued.expiresAt).toBe(1_025_000);
    for (const expiresAt of [1_000_000, 999_999, NaN, Infinity, undefined])
      expect(() =>
        tokens.admission({ userId: "user-a", expiresAt } as never),
      ).toThrow("expiry");
  });

  it("rejects invalid issuers, keys and identifiers without disclosing private material", () => {
    const privatePem = key()
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    for (const issuer of [
      "http://runtime.example.test",
      "https://user@runtime.example.test",
      "https://runtime.example.test?tenant=a",
      " https://runtime.example.test",
      "not a URL",
    ])
      expect(() =>
        createHostedTokenIssuer({ issuer, privateKey: privatePem }),
      ).toThrow("issuer");
    for (const invalidKey of [
      "not private key material",
      generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey,
      key(1024),
      createPublicKey(createPrivateKey(privatePem)),
    ]) {
      let message = "";
      try {
        createHostedTokenIssuer({ issuer: issuerUrl, privateKey: invalidKey });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe("Invalid hosted RSA private key");
      expect(message).not.toContain("BEGIN");
    }
    const tokens = createHostedTokenIssuer({
      issuer: issuerUrl,
      privateKey: privatePem,
    });
    for (const userId of ["", " user", "user a", "user\n"])
      expect(() =>
        tokens.admission({ userId, expiresAt: Date.now() + 60_000 }),
      ).toThrow("user ID");
    expect(() =>
      tokens.admission({
        userId: NaN,
        expiresAt: Date.now() + 60_000,
      } as never),
    ).toThrow("user ID");
    for (const workspaceId of ["", " workspace", "workspace a", "workspace\n"])
      expect(() =>
        tokens.browser(
          { userId: "user-a", expiresAt: Date.now() + 60_000 },
          workspaceId,
        ),
      ).toThrow("workspace ID");
    expect(() =>
      tokens.service(
        { credentialId: "credential a", expiresAt: Date.now() + 60_000 },
        "workspace-a",
      ),
    ).toThrow("credential ID");
  });
});

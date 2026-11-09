import { describe, expect, it } from "vite-plus/test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from "jose";
import {
  createAuthKitAccessTokenVerifier,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  readHostedMcpOAuthConfig,
} from "./hosted-mcp-oauth";

const config = {
  issuer: "https://auth.example.test",
  resource: "https://dashframe.example.test/mcp",
};

async function signer() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: JWTPayload) => {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: config.issuer,
      aud: config.resource,
      sub: "user_01",
      client_id: "claude",
      iat,
      exp: iat + 300,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .sign(privateKey);
  };
  return { keys, sign };
}

describe("AuthKit access token verifier", () => {
  it("accepts a token for this resource and keys the grant by client", async () => {
    const { keys, sign } = await signer();
    const verifier = createAuthKitAccessTokenVerifier(config, keys);
    const result = await verifier.verify(await sign({}));
    expect(result).toMatchObject({
      ok: true,
      token: { subject: "user_01", clientKey: "oauth:claude" },
    });
    const noClient = await verifier.verify(
      await sign({ client_id: undefined }),
    );
    expect(noClient).toMatchObject({ ok: true, token: { clientKey: "oauth" } });
  });

  it("rejects wrong audience, wrong issuer, expired, foreign-key, and unsigned tokens as invalid", async () => {
    const { keys, sign } = await signer();
    const other = await signer();
    const verifier = createAuthKitAccessTokenVerifier(config, keys);
    const { privateKey } = await generateKeyPair("RS256");
    const tokens = [
      await sign({ aud: "https://other.example.test/mcp" }),
      await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer("https://evil.example.test")
        .setAudience(config.resource)
        .setSubject("user_01")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey),
      await sign({ exp: Math.floor(Date.now() / 1000) - 120 }),
      await other.sign({}),
      `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: config.issuer, aud: config.resource, sub: "user_01", iat: 1, exp: 9_999_999_999 })).toString("base64url")}.`,
      await sign({ sub: "user 01" }),
      "not-a-jwt",
    ];
    for (const token of tokens)
      expect(await verifier.verify(token)).toEqual({
        ok: false,
        reason: "invalid",
      });
  });

  it("reports a key-fetch failure as unavailable, not as a bad token", async () => {
    const { sign } = await signer();
    const verifier = createAuthKitAccessTokenVerifier(config, async () => {
      throw new TypeError("fetch failed");
    });
    expect(await verifier.verify(await sign({}))).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("protected resource metadata", () => {
  it("names this exact MCP URL and the AuthKit issuer first", () => {
    expect(protectedResourceMetadata(config)).toMatchObject({
      resource: "https://dashframe.example.test/mcp",
      authorization_servers: ["https://auth.example.test"],
      bearer_methods_supported: ["header"],
    });
    expect(protectedResourceMetadataUrl(config)).toBe(
      "https://dashframe.example.test/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("stays off without an issuer and refuses a non-HTTPS one", () => {
    expect(
      readHostedMcpOAuthConfig({}, "https://dashframe.example.test"),
    ).toBeUndefined();
    expect(
      readHostedMcpOAuthConfig(
        { DASHFRAME_MCP_OAUTH_ISSUER: "https://auth.example.test" },
        "https://dashframe.example.test/",
      ),
    ).toEqual(config);
    expect(() =>
      readHostedMcpOAuthConfig(
        { DASHFRAME_MCP_OAUTH_ISSUER: "http://auth.example.test" },
        "https://dashframe.example.test",
      ),
    ).toThrow("Invalid MCP OAuth issuer");
  });
});

import { describe, expect, it } from "vite-plus/test";
import { Hono } from "hono";
import { ConvexError } from "convex/values";
import {
  mountHostedMcpRoutes,
  type HostedMcpOAuthOptions,
} from "./hosted-mcp-routes";
import type { AgentTokenVerification } from "./hosted-mcp-oauth";
import type { HostedAdmission } from "./hosted-admission-service";
import type { EnsuredAgentGrant } from "./hosted-agent-grants";
import type { HostedPrincipalTokenSource } from "./hosted-token-issuer";

const origin = "https://dashframe.example.test";
const metadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
const config = {
  issuer: "https://auth.example.test",
  resource: `${origin}/mcp`,
};

function setup(
  overrides: {
    verify?: AgentTokenVerification;
    admission?: HostedAdmission | Error;
    grant?: EnsuredAgentGrant;
    bindingFails?: boolean | "outage";
    oauth?: false;
  } = {},
) {
  const calls = {
    admission: 0,
    ensure: [] as unknown[][],
    served: [] as {
      workspaceId: string;
      ownerId: string;
      source: HostedPrincipalTokenSource;
    }[],
  };
  const issuedAt = Math.floor(Date.now() / 1000);
  const oauth: HostedMcpOAuthOptions = {
    config,
    verifier: {
      verify: async () =>
        overrides.verify ?? {
          ok: true,
          token: {
            subject: "user_01",
            clientKey: "oauth:claude",
            issuedAt,
            expiresAt: Date.now() + 300_000,
          },
        },
    },
    admission: {
      resolve: async () => {
        calls.admission++;
        const result = overrides.admission ?? {
          status: "admitted",
          workspaceId: "w1",
        };
        if (result instanceof Error) throw result;
        return result;
      },
    },
    grants: {
      ensure: async (...args) => {
        calls.ensure.push(args);
        return overrides.grant ?? { status: "active", grantId: "g1" };
      },
    },
  };
  const app = new Hono();
  let bindingFails = overrides.bindingFails ?? false;
  mountHostedMcpRoutes(app, {
    publicOrigin: origin,
    serviceAccess: {
      resolve: async (workspaceId, source) => {
        if (bindingFails === "outage") throw new TypeError("fetch failed");
        if (bindingFails) throw new ConvexError("Credential revoked");
        return {
          workspaceId,
          credentialId: source.credentialId,
          subject: "user_01",
        };
      },
    },
    withPrincipalContext: async (workspaceId, ownerId, source) => {
      calls.served.push({ workspaceId, ownerId, source });
      return new Response("served");
    },
    oauth: overrides.oauth === false ? undefined : oauth,
  });
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`${origin}${path}`, { method: "POST", ...init });
  const authorized = (init: RequestInit = {}) =>
    request("/mcp", {
      ...init,
      headers: { Authorization: "Bearer a.b.c", ...init.headers },
    });
  return {
    calls,
    request,
    authorized,
    setBindingFails: (value: boolean | "outage") => (bindingFails = value),
  };
}

describe("protected resource metadata routes", () => {
  it("serves RFC 9728 metadata at both well-known paths", async () => {
    const { request } = setup();
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = await request(path, { method: "GET" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        resource: `${origin}/mcp`,
        authorization_servers: [config.issuer],
      });
    }
  });

  it("is absent and /mcp is unavailable when OAuth is not configured", async () => {
    const { request, authorized } = setup({ oauth: false });
    expect(
      (
        await request("/.well-known/oauth-protected-resource", {
          method: "GET",
        })
      ).status,
    ).toBe(404);
    expect((await authorized()).status).toBe(503);
  });
});

describe("universal /mcp endpoint", () => {
  it("starts sign-in with a 401 that points at the metadata", async () => {
    const { request } = setup();
    for (const headers of [{}, { Authorization: "Basic abc" }] as Record<
      string,
      string
    >[]) {
      const response = await request("/mcp", { headers });
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        `Bearer resource_metadata="${metadataUrl}"`,
      );
    }
  });

  it("accepts the Bearer scheme in any letter case", async () => {
    const { request } = setup();
    for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
      const response = await request("/mcp", {
        headers: { Authorization: `${scheme} a.b.c` },
      });
      expect(await response.text()).toBe("served");
    }
  });

  it("answers an invalid token with invalid_token and a key outage with 503", async () => {
    const invalid = await setup({
      verify: { ok: false, reason: "invalid" },
    }).authorized();
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${metadataUrl}", error="invalid_token"`,
    );
    const outage = await setup({
      verify: { ok: false, reason: "unavailable" },
    }).authorized();
    expect(outage.status).toBe(503);
    expect(outage.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("refuses a foreign Origin before reading the token", async () => {
    const { authorized, calls } = setup();
    const response = await authorized({
      headers: { Origin: "https://evil.example.test" },
    });
    expect(response.status).toBe(403);
    expect(calls.admission).toBe(0);
  });

  it("returns 403, not 401, for an account without admission", async () => {
    for (const status of ["pending", "revoked"] as const) {
      const response = await setup({
        admission: { status, workspaceId: null },
      }).authorized();
      expect(response.status).toBe(403);
      expect(response.headers.get("WWW-Authenticate")).toBeNull();
    }
    expect(
      (await setup({ admission: new Error("down") }).authorized()).status,
    ).toBe(503);
  });

  it("refuses a token minted before its grant was revoked", async () => {
    const response = await setup({ grant: { status: "revoked" } }).authorized();
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("invalid_token");
  });

  it("serves the admitted workspace as the grant's service principal and caches the binding", async () => {
    const { authorized, calls } = setup();
    expect(await (await authorized()).text()).toBe("served");
    expect(await (await authorized()).text()).toBe("served");
    expect(calls.admission).toBe(1);
    expect(calls.ensure).toHaveLength(1);
    expect(calls.ensure[0]!.slice(1)).toEqual(["w1", "oauth:claude"]);
    expect(calls.served).toHaveLength(2);
    expect(calls.served[0]).toMatchObject({
      workspaceId: "w1",
      ownerId: "user_01",
      source: { kind: "service", credentialId: "g1" },
    });
    const source = calls.served[0]!.source;
    expect(source.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("drops the cached binding when the service check fails", async () => {
    const { authorized, calls, setBindingFails } = setup();
    await authorized();
    setBindingFails(true);
    const denied = await authorized();
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toContain("invalid_token");
    setBindingFails(false);
    await authorized();
    expect(calls.admission).toBe(2);
  });

  it("answers a backend outage in the service check with 503, not a challenge", async () => {
    const { authorized, setBindingFails } = setup();
    await authorized();
    setBindingFails("outage");
    const response = await authorized();
    expect(response.status).toBe(503);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("rejects a token that is already within a second of expiry", async () => {
    const response = await setup({
      verify: {
        ok: true,
        token: {
          subject: "user_01",
          clientKey: "oauth",
          issuedAt: 1,
          expiresAt: Date.now() + 500,
        },
      },
    }).authorized();
    expect(response.status).toBe(401);
  });
});

describe("workspace /mcp endpoint", () => {
  it("still requires a named credential and sends no OAuth challenge", async () => {
    const { request } = setup();
    const response = await request("/workspaces/w1/mcp", {
      headers: { Authorization: "Bearer a.b.c" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });
});

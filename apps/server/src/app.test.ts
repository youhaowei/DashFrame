/**
 * Integration smoke for the DashFrame loopback server.
 *
 * Proves the full path the renderer relies on — open a real project, start the
 * server on loopback, and round-trip `projectInfo` over HTTP — without Electron.
 * This is the automated proxy for the ticket's "verify by running the app".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  duckdbColumnsToArrowIpc,
  FileDataFrameStorage,
  NativeDuckDBEngine,
} from "@dashframe/engine-server";
import {
  ApiAccessCredentials,
  CREDENTIAL_CLASS,
  openProject,
  schema,
  type ProjectHandle,
} from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  makeSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { applyCommands } from "@wystack/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertBindAuthorized,
  buildDashframeApp,
  createDashframeServer,
  createDraftController,
  type DashframeServer,
} from "./app";
import { functions, type ProjectInfoResult } from "./functions";
import { cmd } from "./functions/commands";
import { LOCAL_USER_ID } from "./permissions";

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function makeSecretServices(rootDir: string): {
  vault: SecretVault;
  accessCredentials: ApiAccessCredentials;
} {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault(CREDENTIAL_CLASS.ServeToken, "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  return { vault, accessCredentials: new ApiAccessCredentials(vault, rootDir) };
}

function makeAccessCredentials(rootDir: string): ApiAccessCredentials {
  return makeSecretServices(rootDir).accessCredentials;
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForWsAuth(
  url: string,
  token: string | null,
): Promise<"authenticated" | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error("Timed out waiting for WebSocket auth result"));
    }, 5_000);

    function finish(result: "authenticated" | number) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token }));
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string };
      if (message.type === "authenticated") {
        finish("authenticated");
        ws.close();
      }
    };
    ws.onclose = (event) => {
      finish(event.code);
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("WebSocket failed"));
    };
  });
}

describe("bind-auth gate", () => {
  /**
   * Secure-by-default: the gate decides allow/deny purely from (host, token,
   * insecure). It is tested directly via `assertBindAuthorized` — the same
   * function `createDashframeServer` runs before any socket bind — so each
   * branch is exercised with no DB and no real listener. Crucially this lets
   * the token-allows-NON-loopback branch (the security-critical allow-path)
   * run against a genuinely non-loopback host without binding 0.0.0.0 in CI.
   */
  it("non-loopback + no token → refuses (the secure default)", () => {
    expect(() =>
      assertBindAuthorized({ hostname: "0.0.0.0", authToken: undefined }),
    ).toThrow(/refusing to bind.*without an auth token/i);
  });

  it("non-loopback + token → allowed (token satisfies the gate on a network bind)", () => {
    // 0.0.0.0 is genuinely non-loopback, so this exercises the real allow-path:
    // the gate permits the bind *because of the token*, not via any loopback
    // short-circuit. If the token branch were removed, this would throw.
    expect(() =>
      assertBindAuthorized({ hostname: "0.0.0.0", authToken: "a-valid-token" }),
    ).not.toThrow();
  });

  it("non-loopback + authRef → allowed (vault ref satisfies the gate equally)", () => {
    // A well-formed SecretRef is treated as equivalent to authToken for the
    // bind-auth gate. The ref itself carries no secret — it is opaque.
    const ref = makeSecretRef();
    expect(() =>
      assertBindAuthorized({
        hostname: "0.0.0.0",
        authRef: ref,
        authToken: undefined,
      }),
    ).not.toThrow();
  });

  it("loopback + no token → allowed (local dev path)", () => {
    // 127.0.0.1 is loopback and reachable only from this machine, so no token
    // is required.
    expect(() =>
      assertBindAuthorized({ hostname: "127.0.0.1", authToken: undefined }),
    ).not.toThrow();
  });

  // Regression for #243. `assertBindAuthorized` carried its own copy of the
  // loopback check, so the same prefix-matching bypass existed on the
  // `createDashframeServer` path independently of the CLI path. Both now share
  // `isLoopbackHost`; these pin that the factory gate rejects them too. Only
  // the two DNS names were the actual bypass — see the per-case notes in
  // index.test.ts for why `127foo` and `127.1` ride along.
  it.each([
    "127.attacker.example",
    "127.0.0.1.evil.example",
    "127foo",
    "127.1",
  ])("host %s is not loopback → refuses without a token", (hostname) => {
    expect(() =>
      assertBindAuthorized({ hostname, authToken: undefined }),
    ).toThrow(/refusing to bind.*without an auth token/i);
  });

  it("real 127.0.0.0/8 literals stay loopback → no token required", () => {
    for (const hostname of ["127.0.0.1", "127.0.0.53", "127.1.2.3"]) {
      expect(() =>
        assertBindAuthorized({ hostname, authToken: undefined }),
      ).not.toThrow();
    }
  });

  it("non-loopback + no token + insecure → allowed (deliberate opt-out)", () => {
    expect(() =>
      assertBindAuthorized({
        hostname: "0.0.0.0",
        authToken: undefined,
        insecure: true,
      }),
    ).not.toThrow();
  });

  it("createDashframeServer refuses a non-loopback bind without a token end-to-end", async () => {
    // The factory routes the same config through the gate, so a disallowed bind
    // throws before any socket opens — covers the wiring, not just the gate.
    const root = mkdtempSync(join(tmpdir(), "dashframe-gate-"));
    const project = await openProject({ dir: join(root, "proj") });
    try {
      await expect(
        createDashframeServer({
          db: project.db,
          hostname: "0.0.0.0",
          // authToken deliberately omitted
        }),
      ).rejects.toThrow(/refusing to bind.*without an auth token/i);
    } finally {
      await project.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("createDashframeServer rejects authRef without vault (misconfiguration guard)", async () => {
    // Defensive invariant: authRef requires vault. Without vault the ref cannot
    // be resolved and the server would silently start unauthenticated. The guard
    // must throw before any socket opens.
    const root = mkdtempSync(join(tmpdir(), "dashframe-guard-"));
    const project = await openProject({ dir: join(root, "proj") });
    try {
      const ref = makeSecretRef();
      await expect(
        createDashframeServer({
          db: project.db,
          authRef: ref,
          // vault deliberately omitted
        }),
      ).rejects.toThrow(/authRef requires vault/i);
    } finally {
      await project.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("createDashframeServer", () => {
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-server-"));
    project = null;
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("HTTP API", () => {
    it("should serve projectInfo over loopback HTTP from the project DB", async () => {
      project = await openProject({
        dir: join(root, "proj"),
        name: "Smoke Co",
      });
      server = await createDashframeServer({ db: project.db });

      // Bound to an ephemeral loopback port.
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toBe(`http://127.0.0.1:${server.port}`);

      // Same request the WyStack client issues for a query: GET /api/:fn?args=.
      const res = await fetch(
        `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`,
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: ProjectInfoResult };
      expect(body.data.name).toBe("Smoke Co");
      expect(body.data.projectId).toBe(project.meta.projectId);
      expect(body.data.version).toBe(project.meta.version);

      const capabilitiesResponse = await fetch(
        `${server.url}/api/getAccessCapabilities?args=${encodeURIComponent("{}")}`,
      );
      expect(await capabilitiesResponse.json()).toMatchObject({
        data: { canManageCredentials: false },
      });

      const catalogResponse = await fetch(
        `${server.url}/api/getConnectorCatalog?args=${encodeURIComponent("{}")}`,
      );
      expect(catalogResponse.status).toBe(200);
      const catalogBody = (await catalogResponse.json()) as {
        data: { id: string }[];
      };
      const catalogIds = catalogBody.data.map((entry) => entry.id);
      expect(catalogIds).toContain("local");
      expect(catalogIds).toContain("notion");
      expect(catalogIds).toContain("postgres");
      expect(catalogIds).not.toContain("rest");
    });

    it("denies before disclosing that no secret key is configured", async () => {
      // Ordering guard on `configuredAccessCredentialProcedure`: `.authorize`
      // must run BEFORE the capability-check middleware. This server has no
      // `authToken`/`authRef`, so no resolver runs and the request context
      // carries no `principal` at all — the `accessCredentials.manage` check
      // denies (403) before the "no secret key configured" middleware can turn
      // an unauthenticated request into a 500 carrying an operator-facing
      // env-var hint. Swapping the two `.use`/`.authorize` calls fails this.
      project = await openProject({
        dir: join(root, "proj"),
        name: "No key Co",
      });
      server = await createDashframeServer({ db: project.db });

      const response = await fetch(`${server.url}/api/issueAccessCredential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Unavailable credential" }),
      });
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).not.toContain("No secret key configured");
    });

    it("rejects at the transport before any procedure middleware runs on a token-protected server", async () => {
      // Narrower than it looks, and deliberately so: with `authToken` set, an
      // unauthenticated request never reaches `issueAccessCredential`'s
      // middleware chain at all — transport auth answers 401 first. It does
      // NOT prove the `.authorize`-before-capability-check ordering (the test
      // above owns that); it pins that the transport layer stays in front of
      // the procedure layer, so no procedure-level message can leak to a
      // caller who never authenticated.
      project = await openProject({
        dir: join(root, "proj"),
        name: "Token Co, no key",
      });
      server = await createDashframeServer({
        db: project.db,
        authToken: "renderer-token",
        // No `accessCredentials` — this server has no key configured.
      });

      const response = await fetch(`${server.url}/api/issueAccessCredential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Unavailable credential" }),
      });
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).not.toContain("No secret key configured");
    });

    it("stays reachable on loopback when a secret key is configured but no token is", async () => {
      // Regression guard: configuring `DASHFRAME_SECRET_KEY` alone used to
      // register the access-credential resolver, which defined `resolveContext`
      // and turned every unauthenticated loopback request into a 401 with no
      // way to bootstrap the first credential. A key must not, on its own,
      // close the loopback server.
      project = await openProject({
        dir: join(root, "proj"),
        name: "Keyed Co, no token",
      });
      const { vault, accessCredentials } = makeSecretServices(
        join(root, "access-credentials"),
      );
      server = await createDashframeServer({
        db: project.db,
        vault,
        accessCredentials,
        // No `authToken`/`authRef` — a keyed loopback serve.
      });

      const res = await fetch(
        `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`,
      );
      expect(res.status).toBe(200);
      expect((await res.json()) as { data: ProjectInfoResult }).toMatchObject({
        data: { name: "Keyed Co, no token" },
      });
    });

    it("keyed token-less loopback: commands 200, but issuing an access credential still 403s", async () => {
      // Delta-review regression: a keyed loopback serve with no
      // authToken/authRef has `hasPrimaryAuth === false`, so main's gate
      // (above) keeps the accessCredentials resolver OUT of the chain —
      // `credentialResolvers` ends up empty, same as the fully-unkeyed case.
      // That means THIS config also hits the loopback-synthesis branch in
      // `createDashframeServer` (see app.ts), and the synthesized principal
      // must not double as the operator: `commands.commit` only requires
      // `principal.kind === "user"` (satisfied — commands succeed below),
      // but `accessCredentials.manage` additionally requires
      // `principal.userId === LOCAL_USER_ID` specifically, which the
      // synthesized `LOOPBACK_ANON_USER_ID` principal is NOT — so minting a
      // credential over this unauthenticated bind must still 403, even
      // though a key is configured and issuing credentials is otherwise
      // reachable in principle.
      project = await openProject({
        dir: join(root, "proj"),
        name: "Keyed Co, no token, commands",
      });
      const { vault, accessCredentials } = makeSecretServices(
        join(root, "access-credentials"),
      );
      server = await createDashframeServer({
        db: project.db,
        vault,
        accessCredentials,
        // No `authToken`/`authRef` — a keyed loopback serve.
      });

      const sourceId = crypto.randomUUID();
      const commandRes = await fetch(`${server.url}/api/createDataSource`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          cmd("CreateDataSource", {
            id: sourceId,
            type: "csv",
            name: "Keyed loopback",
          }).args,
        ),
      });
      expect(commandRes.status).toBe(200);

      const issueRes = await fetch(`${server.url}/api/issueAccessCredential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Should never mint" }),
      });
      expect(issueRes.status).toBe(403);
    });

    it("runs commands on the token-less loopback config (no authToken/authRef/accessCredentials configured)", async () => {
      // Pins the fix for the loopback-becomes-read-only regression: before,
      // an absent principal denied every `.authorize(commands.commit)`
      // procedure (all 31 commands, publishDraft, discardDraft,
      // commitBatch), even though `index.ts`'s own help text documents this
      // exact config ("--project ... no --token ...") as the safe default —
      // pre-existing behavior let every request through as the local
      // operator. `createDashframeServer` must synthesize that principal
      // when no auth mechanism is configured at all.
      project = await openProject({ dir: join(root, "proj") });
      server = await createDashframeServer({ db: project.db });

      const sourceId = crypto.randomUUID();
      // No Authorization header at all.
      const res = await fetch(`${server.url}/api/createDataSource`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          cmd("CreateDataSource", {
            id: sourceId,
            type: "csv",
            name: "Loopback",
          }).args,
        ),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string } };
      expect(body.data.id).toBe(sourceId);

      // An arbitrary bearer token must not be interpreted as a service
      // credential in this mode — there is no `accessCredentials` resolver
      // configured to authenticate it, so the synthesized loopback resolver
      // is the only one in play and every request (token or not) resolves
      // to the SAME local-user principal. A service principal is simply
      // unreachable in a config with no accessCredentials configured.
      const otherSourceId = crypto.randomUUID();
      const withRandomToken = await fetch(
        `${server.url}/api/createDataSource`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...bearer("some-random-value-nobody-configured"),
          },
          body: JSON.stringify(
            cmd("CreateDataSource", {
              id: otherSourceId,
              type: "csv",
              name: "Loopback 2",
            }).args,
          ),
        },
      );
      expect(withRandomToken.status).toBe(200);
    });

    it("token-less loopback synthesizes a non-operator principal — commands 200, minting an access credential still 403s", async () => {
      // Delta-review finding: the loopback synthesis must NOT reuse
      // `LOCAL_USER_ID` (the operator's own identity). `commands.commit`
      // only requires `principal.kind === "user"`, so a distinct synthetic
      // id keeps every command writable (first assertion below) — but
      // `accessCredentials.manage` additionally requires
      // `principal.userId === LOCAL_USER_ID` specifically, so an
      // unauthenticated loopback request must NOT be able to mint a durable,
      // off-host-usable API credential (second assertion). Reusing
      // `LOCAL_USER_ID` for the synthesized principal would pass both checks
      // and silently let any local process on the loopback bind mint
      // credentials nobody typed a token for.
      project = await openProject({ dir: join(root, "proj") });
      server = await createDashframeServer({ db: project.db });

      const sourceId = crypto.randomUUID();
      const commandRes = await fetch(`${server.url}/api/createDataSource`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          cmd("CreateDataSource", {
            id: sourceId,
            type: "csv",
            name: "Loopback anon",
          }).args,
        ),
      });
      expect(commandRes.status).toBe(200);

      const issueRes = await fetch(`${server.url}/api/issueAccessCredential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Should never mint" }),
      });
      expect(issueRes.status).toBe(403);
    });

    it("issues, authenticates, and revokes a workspace access credential", async () => {
      project = await openProject({
        dir: join(root, "proj"),
        name: "Access Co",
      });
      const accessCredentials = makeAccessCredentials(
        join(root, "access-credentials"),
      );
      server = await createDashframeServer({
        db: project.db,
        accessCredentials,
        authToken: "renderer-token",
      });

      const connectionResponse = await fetch(
        `${server.url}/api/getAccessConnectionInfo?args=${encodeURIComponent("{}")}`,
        { headers: bearer("renderer-token") },
      );
      expect(connectionResponse.status).toBe(200);
      const connection = (await connectionResponse.json()) as {
        data: { endpoint: string };
      };
      expect(connection.data).toMatchObject({
        endpoint: `${server.url}/api`,
      });

      const issueResponse = await fetch(
        `${server.url}/api/issueAccessCredential`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...bearer("renderer-token"),
          },
          body: JSON.stringify({ name: "Codex test" }),
        },
      );
      expect(issueResponse.status).toBe(200);
      const issued = (await issueResponse.json()) as {
        data: {
          credential: { id: string; name: string };
          accessCredential: string;
        };
      };
      expect(issued.data.credential.name).toBe("Codex test");

      const ownerCapabilities = await fetch(
        `${server.url}/api/getAccessCapabilities?args=${encodeURIComponent("{}")}`,
        { headers: bearer("renderer-token") },
      );
      expect(await ownerCapabilities.json()).toMatchObject({
        data: { canManageCredentials: true },
      });

      const projectInfoUrl = `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`;
      expect((await fetch(projectInfoUrl)).status).toBe(401);
      expect(
        (
          await fetch(projectInfoUrl, {
            headers: bearer(issued.data.accessCredential),
          })
        ).status,
      ).toBe(200);

      const externalCapabilities = await fetch(
        `${server.url}/api/getAccessCapabilities?args=${encodeURIComponent("{}")}`,
        { headers: bearer(issued.data.accessCredential) },
      );
      expect(await externalCapabilities.json()).toMatchObject({
        data: { canManageCredentials: false },
      });
      const externalIssueResponse = await fetch(
        `${server.url}/api/issueAccessCredential`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...bearer(issued.data.accessCredential),
          },
          body: JSON.stringify({ name: "API-issued successor" }),
        },
      );
      expect(externalIssueResponse.status).toBe(403);

      const externalListResponse = await fetch(
        `${server.url}/api/listAccessCredentials?args=${encodeURIComponent("{}")}`,
        { headers: bearer(issued.data.accessCredential) },
      );
      expect(externalListResponse.status).toBe(403);

      const externalRevokeResponse = await fetch(
        `${server.url}/api/revokeAccessCredential`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...bearer(issued.data.accessCredential),
          },
          body: JSON.stringify({ id: issued.data.credential.id }),
        },
      );
      expect(externalRevokeResponse.status).toBe(403);

      const ownerListResponse = await fetch(
        `${server.url}/api/listAccessCredentials?args=${encodeURIComponent("{}")}`,
        { headers: bearer("renderer-token") },
      );
      expect(ownerListResponse.status).toBe(200);
      const listed = (await ownerListResponse.json()) as {
        data: { id: string }[];
      };
      expect(listed.data.some((c) => c.id === issued.data.credential.id)).toBe(
        true,
      );

      const revokeResponse = await fetch(
        `${server.url}/api/revokeAccessCredential`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...bearer("renderer-token"),
          },
          body: JSON.stringify({ id: issued.data.credential.id }),
        },
      );
      expect(revokeResponse.status).toBe(200);
      expect(
        (
          await fetch(projectInfoUrl, {
            headers: bearer(issued.data.accessCredential),
          })
        ).status,
      ).toBe(401);
    });

    it("denies a legacy userId context on a protected function", async () => {
      project = await openProject({ dir: join(root, "proj") });
      const app = await buildDashframeApp({
        db: project.db,
        accessCredentials: makeAccessCredentials(
          join(root, "access-credentials"),
        ),
        getServerEndpoint: () => "http://127.0.0.1:4000/api",
      });

      await expect(
        app.call("getAccessConnectionInfo", {}, { userId: LOCAL_USER_ID }),
      ).rejects.toMatchObject({ name: "PermissionDeniedError" });
    });

    it("falls through a non-matching operator token to a valid access credential", async () => {
      project = await openProject({ dir: join(root, "proj") });
      const accessCredentials = makeAccessCredentials(
        join(root, "access-credentials"),
      );
      const issued = await accessCredentials.issue("Automation client");
      server = await createDashframeServer({
        db: project.db,
        accessCredentials,
        authToken: "renderer-token",
      });

      const response = await fetch(
        `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`,
        { headers: bearer(issued.token) },
      );

      expect(response.status).toBe(200);
    });

    it("denies when every configured credential resolver returns null", async () => {
      project = await openProject({ dir: join(root, "proj") });
      server = await createDashframeServer({
        db: project.db,
        accessCredentials: makeAccessCredentials(
          join(root, "access-credentials"),
        ),
        authToken: "renderer-token",
      });

      const response = await fetch(
        `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`,
        { headers: bearer("not-any-configured-credential") },
      );

      expect(response.status).toBe(401);
    });

    it("rejects a non-object JSON body on /assistant/run with 400, not a crash", async () => {
      project = await openProject({
        dir: join(root, "proj"),
        name: "Run Co",
      });
      server = await createDashframeServer({ db: project.db });

      // "null" is valid JSON, so JSON.parse succeeds — the route must still
      // treat it as a client error instead of throwing at `body.prompt`.
      const res = await fetch(`${server.url}/assistant/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Invalid JSON in request body");
    });

    it("rejects a nonexistent requested assistant provider config instead of falling back", async () => {
      project = await openProject({
        dir: join(root, "proj"),
        name: "Run Co",
      });
      const seedApp = await buildDashframeApp({ db: project.db });
      await seedApp.call("saveAssistantProviderConfig", {
        input: {
          providerId: "ollama",
          displayLabel: "Ollama",
          authKind: "local",
          baseUrl: "http://localhost:11434/v1",
          defaultModel: "llama3.1",
          isDefault: true,
        },
      });
      server = await createDashframeServer({ db: project.db });

      const missingId = "00000000-0000-4000-8000-000000000000";
      const res = await fetch(`${server.url}/assistant/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Say hello",
          provider: missingId,
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain(missingId);
    });

    it("should require the loopback token and allow packaged Origin null", async () => {
      project = await openProject({
        dir: join(root, "proj"),
        name: "Auth Co",
      });
      server = await createDashframeServer({
        db: project.db,
        authToken: "launch-token",
        corsOrigin: "null",
      });

      const url = `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`;

      const noAuth = await fetch(url);
      expect(noAuth.status).toBe(401);

      const wrongAuth = await fetch(url, {
        headers: bearer("wrong-token"),
      });
      expect(wrongAuth.status).toBe(401);

      const preflight = await fetch(`${server.url}/api/projectInfo`, {
        method: "OPTIONS",
        headers: {
          Origin: "null",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      });
      expect(preflight.headers.get("access-control-allow-origin")).toBe("null");
      expect(preflight.headers.get("access-control-allow-headers")).toContain(
        "Authorization",
      );

      const ok = await fetch(url, {
        headers: {
          ...bearer("launch-token"),
          Origin: "null",
        },
      });
      expect(ok.status).toBe(200);
      expect(ok.headers.get("access-control-allow-origin")).toBe("null");

      const body = (await ok.json()) as { data: ProjectInfoResult };
      expect(body.data.name).toBe("Auth Co");
    });
  });

  describe("WebSocket API", () => {
    it("should require the loopback token for WebSocket auth", async () => {
      project = await openProject({ dir: join(root, "proj"), name: "Ws Co" });
      server = await createDashframeServer({
        db: project.db,
        authToken: "launch-token",
      });

      await expect(
        waitForWsAuth(`${server.url.replace(/^http/, "ws")}/api/ws`, "wrong"),
      ).resolves.toBe(4001);

      await expect(
        waitForWsAuth(
          `${server.url.replace(/^http/, "ws")}/api/ws`,
          "launch-token",
        ),
      ).resolves.toBe("authenticated");
    });
  });
});

describe("committed native frame cleanup", () => {
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;
  let storage: FileDataFrameStorage;
  let engine: NativeDuckDBEngine;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-native-cleanup-"));
    project = null;
    server = null;
    storage = new FileDataFrameStorage(join(root, "frames"));
    engine = new NativeDuckDBEngine();
  });

  afterEach(async () => {
    server?.stop();
    await engine.dispose();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function seedRegisteredFrame(value: string): Promise<{
    frameId: string;
    sourceId: string;
    tableId: string;
    tableName: string;
  }> {
    const frameId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const tableId = crypto.randomUUID();
    const tableName = `df_${frameId.replaceAll("-", "_")}`;
    const arrow = duckdbColumnsToArrowIpc([
      { name: "value", typeId: 17, values: [value] },
    ]);
    await storage.save(frameId, arrow);
    await project!.db.insert(schema.dataSources).values({
      id: sourceId,
      name: "Source",
      kind: "csv",
      storage: "live",
      config: {},
      createdBy: { kind: "user" },
    });
    await project!.db.insert(schema.dataFrames).values({
      id: frameId,
      storage: { type: "file", key: frameId },
      fieldIds: [],
      name: "Frame",
      sourceId,
      definitionId: tableId,
    });
    await project!.db.insert(schema.dataTables).values({
      id: tableId,
      dataSourceId: sourceId,
      name: "Table",
      table: "source.csv",
      fields: [],
      metrics: [],
      dataFrameId: frameId,
    });
    return { frameId, sourceId, tableId, tableName };
  }

  async function registerFrame(frameId: string, tableName: string) {
    const response = await fetch(
      `${server!.url}/data/frames/${frameId}/tables/${tableName}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(200);
  }

  async function registerRawTable(
    tableName: string,
    value: string,
  ): Promise<Response> {
    const arrow = duckdbColumnsToArrowIpc([
      { name: "value", typeId: 17, values: [value] },
    ]);
    return fetch(`${server!.url}/data/tables/${tableName}`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.apache.arrow.stream" },
      body: arrow,
    });
  }

  function failNextNativeDrop(): void {
    const connection = (
      engine as unknown as {
        connection: { run(sql: string): Promise<unknown> };
      }
    ).connection;
    vi.spyOn(connection, "run").mockRejectedValueOnce(
      new Error("injected transient native DROP failure"),
    );
  }

  it("reports committed deletion, fires onWrite, and eventually retries native unregister", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const seeded = await seedRegisteredFrame("old");
    const onWrite = vi.fn();
    server = await createDashframeServer({
      db: project.db,
      dataFrameStorage: storage,
      arrowEngine: engine,
      flushSnapshotRetentionWindow: async () => {},
      onWrite,
    });
    await registerFrame(seeded.frameId, seeded.tableName);
    onWrite.mockClear();
    failNextNativeDrop();

    const ws = new WebSocket(`${server.url.replace(/^http/, "ws")}/api/ws`);
    const subscriptionId = "deleted-table-invalidation";
    let markSubscribed!: () => void;
    const subscribed = new Promise<void>((resolve) => {
      markSubscribed = resolve;
    });
    let markInvalidated!: () => void;
    const invalidated = new Promise<void>((resolve) => {
      markInvalidated = resolve;
    });
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: null }));
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        id?: string;
      };
      if (message.type === "authenticated") {
        ws.send(
          JSON.stringify({
            type: "subscribe",
            id: subscriptionId,
            path: "listDataTables",
            args: {},
          }),
        );
      } else if (
        message.type === "subscribed" &&
        message.id === subscriptionId
      ) {
        markSubscribed();
      } else if (
        message.type === "invalidate" &&
        message.id === subscriptionId
      ) {
        markInvalidated();
      }
    };
    await subscribed;

    const response = await fetch(`${server.url}/api/removeDataTable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: seeded.tableId }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).not.toHaveProperty(
      "data.deletedArrowKeys",
    );
    expect(await storage.exists(seeded.frameId)).toBe(false);
    expect(
      (await project.db.select().from(schema.dataFrames)).find(
        (row) => row.id === seeded.frameId,
      ),
    ).toBeUndefined();
    expect(onWrite).toHaveBeenCalledTimes(1);
    await invalidated;
    ws.close();
    await waitUntil(() => !engine.hasTable(seeded.tableName));
  });

  it("never lets an old unregister retry drop a re-registered table generation", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const seeded = await seedRegisteredFrame("old");
    server = await createDashframeServer({
      db: project.db,
      dataFrameStorage: storage,
      arrowEngine: engine,
      flushSnapshotRetentionWindow: async () => {},
    });
    await registerFrame(seeded.frameId, seeded.tableName);
    failNextNativeDrop();

    const deleted = await fetch(`${server.url}/api/removeDataTable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: seeded.tableId }),
    });
    expect(deleted.status).toBe(200);

    const replacement = duckdbColumnsToArrowIpc([
      { name: "value", typeId: 17, values: ["new"] },
    ]);
    await storage.save(seeded.frameId, replacement);
    const replacementTableId = crypto.randomUUID();
    await project.db.insert(schema.dataFrames).values({
      id: seeded.frameId,
      storage: { type: "file", key: seeded.frameId },
      fieldIds: [],
      name: "Replacement",
      sourceId: seeded.sourceId,
      definitionId: replacementTableId,
    });
    await project.db.insert(schema.dataTables).values({
      id: replacementTableId,
      dataSourceId: seeded.sourceId,
      name: "Replacement table",
      table: "replacement.csv",
      fields: [],
      metrics: [],
      dataFrameId: seeded.frameId,
    });
    await registerFrame(seeded.frameId, seeded.tableName);

    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(engine.hasTable(seeded.tableName)).toBe(true);
    expect(
      (await engine.query(`SELECT value FROM "${seeded.tableName}"`)).rows,
    ).toEqual([{ value: "new" }]);
  });

  it("serializes a retry already in flight before a successful newer registration", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const seeded = await seedRegisteredFrame("old");
    server = await createDashframeServer({
      db: project.db,
      dataFrameStorage: storage,
      arrowEngine: engine,
      flushSnapshotRetentionWindow: async () => {},
    });
    await registerFrame(seeded.frameId, seeded.tableName);

    const nativeUnregister = engine.unregisterTable.bind(engine);
    let unregisterCalls = 0;
    let markRetryStarted!: () => void;
    const retryStarted = new Promise<void>((resolve) => {
      markRetryStarted = resolve;
    });
    let releaseRetry!: () => void;
    const retryBlocked = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    vi.spyOn(engine, "unregisterTable").mockImplementation(async (name) => {
      unregisterCalls += 1;
      if (unregisterCalls === 1) {
        throw new Error("injected initial native DROP failure");
      }
      if (unregisterCalls === 2) {
        markRetryStarted();
        await retryBlocked;
      }
      await nativeUnregister(name);
    });

    const deleted = await fetch(`${server.url}/api/removeDataTable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: seeded.tableId }),
    });
    expect(deleted.status).toBe(200);
    await retryStarted;

    const registering = registerRawTable(seeded.tableName, "new");
    releaseRetry();
    expect((await registering).status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(engine.hasTable(seeded.tableName)).toBe(true);
    expect(
      (await engine.query(`SELECT value FROM "${seeded.tableName}"`)).rows,
    ).toEqual([{ value: "new" }]);
  });

  it("keeps the previous cleanup retry alive when same-name replacement registration fails", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const seeded = await seedRegisteredFrame("old");
    server = await createDashframeServer({
      db: project.db,
      dataFrameStorage: storage,
      arrowEngine: engine,
      flushSnapshotRetentionWindow: async () => {},
    });
    await registerFrame(seeded.frameId, seeded.tableName);
    failNextNativeDrop();

    const deleted = await fetch(`${server.url}/api/removeDataTable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: seeded.tableId }),
    });
    expect(deleted.status).toBe(200);
    expect(engine.hasTable(seeded.tableName)).toBe(true);

    vi.spyOn(engine, "registerArrowTable").mockRejectedValueOnce(
      new Error("injected same-name replacement registration failure"),
    );
    const registration = await registerRawTable(
      seeded.tableName,
      "replacement",
    );
    expect(registration.status).toBe(500);

    await waitUntil(() => !engine.hasTable(seeded.tableName));
  });

  it("cancels pending unregister retries when the server stops", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const seeded = await seedRegisteredFrame("old");
    server = await createDashframeServer({
      db: project.db,
      dataFrameStorage: storage,
      arrowEngine: engine,
      flushSnapshotRetentionWindow: async () => {},
    });
    await registerFrame(seeded.frameId, seeded.tableName);
    const connection = (
      engine as unknown as {
        connection: { run(sql: string): Promise<unknown> };
      }
    ).connection;
    const drop = vi
      .spyOn(connection, "run")
      .mockRejectedValue(new Error("persistent native DROP failure"));

    const deleted = await fetch(`${server.url}/api/removeDataTable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: seeded.tableId }),
    });
    expect(deleted.status).toBe(200);
    expect(drop).toHaveBeenCalledTimes(1);

    server.stop();
    server = null;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(drop).toHaveBeenCalledTimes(1);
  });
});

describe("write → subscription invalidation", () => {
  /**
   * Guards the RE-MIRROR POINT documented in app.ts's `call` wrapper.
   *
   * wystack collapsed invalidation onto one per-app source: `rawApp.call` fuses
   * `emit(tablesWritten)` after a write, and `createRoutes` no longer publishes
   * from the returned `tablesWritten`. DashFrame's `call` chain never reaches
   * `rawApp.call` — the draft seam composes `createTracked → runHandler` itself —
   * so the fuse does not fire for us and our wrapper has to emit explicitly.
   *
   * Why this test and not a unit assertion on `emit`: when that emit went
   * missing, typecheck and all 48 package test suites stayed green and only the
   * chart E2E caught it, ~5 minutes downstream. The contract that actually
   * matters is observable at the wire — a subscriber must receive `invalidate`
   * after somebody else's write — so that is what this asserts, over a real WS
   * against a real server. A future pin bump that moves the emit seam again
   * fails HERE, in unit-test time.
   */
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-invalidate-"));
    project = null;
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("delivers invalidate to a live subscriber after a mutation on another surface", async () => {
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      authToken: "renderer-token",
    });

    const ws = new WebSocket(`${server.url.replace(/^http/, "ws")}/api/ws`);
    const subscriptionId = "sub-invalidate-1";

    const invalidated = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("no invalidate frame within 10s")),
        10_000,
      );
      ws.onerror = () => reject(new Error("WebSocket failed"));
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "auth", token: "renderer-token" }));
      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as {
          type?: string;
          id?: string;
        };
        if (msg.type === "authenticated") {
          ws.send(
            JSON.stringify({
              type: "subscribe",
              id: subscriptionId,
              path: "listDataSources",
              args: {},
            }),
          );
          return;
        }
        // Wait for the server's ack before writing: subscribing is not
        // instantaneous, and a write that lands before the entry is in the
        // store would produce no invalidate for reasons unrelated to the seam.
        if (msg.type === "subscribed" && msg.id === subscriptionId) {
          void fetch(`${server!.url}/api/getOrCreateDataSource`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...bearer("renderer-token"),
            },
            body: JSON.stringify({
              id: crypto.randomUUID(),
              type: "csv",
              name: "Invalidation Source",
            }),
          });
          return;
        }
        if (msg.type === "invalidate" && msg.id === subscriptionId) {
          clearTimeout(timer);
          resolve(msg.id);
        }
      };
    });

    await expect(invalidated).resolves.toBe(subscriptionId);
    ws.close();
  });
});

describe("onWrite hook", () => {
  /**
   * Tests for the `onWrite` durability hook (see GitHub issue #88 / #90).
   *
   * Contracts:
   *   - A successful artifact-DB mutation fires onWrite exactly once.
   *   - N rapid successful mutations fire onWrite exactly N times (the
   *     debounce lives in SnapshotScheduler.touch(), not in the server).
   *   - A failed/invalid mutation does NOT fire onWrite.
   *   - A read-only query does NOT fire onWrite.
   *
   * Testing strategy: inject a mock onWrite callback and route real HTTP
   * mutations through the server (same path the renderer uses) — no
   * dependency on wall-clock or real PGlite snapshots.
   */
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-onwrite-"));
    project = null;
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  function postMutation(
    url: string,
    path: string,
    body: unknown,
  ): Promise<Response> {
    return fetch(`${url}/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...bearer("renderer-token"),
      },
      body: JSON.stringify(body),
    });
  }

  it("should fire onWrite once after a successful mutation", async () => {
    const onWriteCalls: number[] = [];
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      authToken: "renderer-token",
      onWrite: () => {
        onWriteCalls.push(Date.now());
      },
    });

    const res = await postMutation(server.url, "getOrCreateDataSource", {
      id: crypto.randomUUID(),
      type: "csv",
      name: "My Source",
    });
    expect(res.status).toBe(200);
    expect(onWriteCalls).toHaveLength(1);
  });

  it("should fire onWrite once per successful mutation (N writes → N calls, no server-level debounce)", async () => {
    let callCount = 0;
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      authToken: "renderer-token",
      onWrite: () => {
        callCount++;
      },
    });

    // Three rapid creates — each is a separate committed transaction.
    for (let i = 0; i < 3; i++) {
      const res = await postMutation(server.url, "getOrCreateDataSource", {
        id: crypto.randomUUID(),
        type: "csv",
        name: `Source ${i}`,
      });
      expect(res.status).toBe(200);
    }
    // The server fires onWrite once per committed write — debounce is the
    // scheduler's job, not the server's. The host (SnapshotScheduler.touch)
    // collapses rapid bursts; the server must not under-count them.
    expect(callCount).toBe(3);
  });

  it("should NOT fire onWrite when the mutation fails (invalid args)", async () => {
    let callCount = 0;
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      authToken: "renderer-token",
      onWrite: () => {
        callCount++;
      },
    });

    // Send a mutation with a missing required field — Zod validation rejects it
    // before any DB write occurs, so no transaction commits.
    const res = await postMutation(server.url, "getOrCreateDataSource", {
      // Missing required `id` and `name` fields → validation error, no write.
      type: "csv",
    });
    expect(res.status).toBe(400);
    expect(callCount).toBe(0);
  });

  it("should NOT fire onWrite for a read-only query", async () => {
    let callCount = 0;
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      authToken: "renderer-token",
      onWrite: () => {
        callCount++;
      },
    });

    const res = await fetch(
      `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`,
      { headers: bearer("renderer-token") },
    );
    expect(res.status).toBe(200);
    expect(callCount).toBe(0);
  });

  it("should work without onWrite (backward-compatible — omitting it changes nothing)", async () => {
    // No onWrite configured — server should start and mutations should succeed.
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      authToken: "renderer-token",
    });

    const res = await postMutation(server.url, "getOrCreateDataSource", {
      id: crypto.randomUUID(),
      type: "csv",
      name: "Compat Test",
    });
    expect(res.status).toBe(200);
  });

  it("should isolate an onWrite that throws — the committed mutation still succeeds", async () => {
    // onWrite runs AFTER the DB write commits. If it throws, the client must
    // still see success — otherwise it would retry a durable write and
    // duplicate artifacts. The hook's failure is swallowed (logged), never
    // propagated.
    project = await openProject({ dir: join(root, "proj") });
    const sourceId = crypto.randomUUID();
    server = await createDashframeServer({
      db: project.db,
      authToken: "renderer-token",
      onWrite: () => {
        throw new Error("snapshot scheduler exploded");
      },
    });

    const res = await postMutation(server.url, "getOrCreateDataSource", {
      id: sourceId,
      type: "csv",
      name: "Resilient",
    });
    // The mutation committed despite the hook throwing.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(sourceId);

    // The write is durable — a follow-up get-or-create returns the same row.
    const verify = await postMutation(server.url, "getOrCreateDataSource", {
      id: sourceId,
      type: "csv",
      name: "Resilient",
    });
    expect(verify.status).toBe(200);
    const verifyBody = (await verify.json()) as { data: { id: string } };
    expect(verifyBody.data.id).toBe(sourceId);
  });
});

describe("buildDashframeApp — vault injection seam", () => {
  /**
   * Covers the security-critical vault seam in buildDashframeApp (the logic
   * extracted from createDashframeServer). Three contracts:
   *
   * 1. Anti-shadow (the load-bearing security invariant): the INJECTED vault
   *    wins over any vault key a caller passes in the request context. A crafted
   *    `context.vault` cannot shadow the server-level vault — staticContext is
   *    spread LAST.
   *
   * 2. Optional-capability omission: when vault and onWrite are omitted, the
   *    required host context still assembles and ordinary calls keep working.
   *
   * 3. Vault threads into handlers: the injected vault is visible to handlers
   *    (via `vaultFromCtx`), enabling credential writes that the no-vault path
   *    refuses.
   *
   * Tests drive the REAL buildDashframeApp, not a reimplemented copy — a merge-
   * order regression in app.ts would fail these tests.
   */
  let root: string;
  let project: ProjectHandle;

  // Compose a test vault with the connector-key class registered.
  function makeTestVault(): { vault: SecretVault; backend: TestBackend } {
    const backend = new TestBackend();
    const registry = new SecretRegistry();
    registry.register("test", backend, { fallback: true });
    registry.setClassDefault(CREDENTIAL_CLASS.ConnectorKey, "test");
    const vault = new SecretVault(registry, new InMemoryMappingStore());
    return { vault, backend };
  }

  // Compose a vault that has NO connector-key class registered — any credential
  // store call will throw "no default backend for class connector-key". Used as
  // the "bogus attacker vault" in the anti-shadow test.
  function makeBogusVault(): SecretVault {
    const backend = new TestBackend();
    const registry = new SecretRegistry();
    // Deliberately do NOT register connector-key default — a store() call for
    // that class will fail.
    registry.register("bogus", backend, { fallback: false });
    return new SecretVault(registry, new InMemoryMappingStore());
  }

  async function createSource(
    app: Awaited<ReturnType<typeof buildDashframeApp>>,
    input: Omit<Parameters<typeof cmd<"CreateDataSource">>[1], "id">,
    context?: Record<string, unknown>,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await applyCommands(app, [cmd("CreateDataSource", { id, ...input })], {
      mode: "commit",
      context: {
        ...(context ?? {}),
        principal: { kind: "user", userId: LOCAL_USER_ID },
      },
    });
    return id;
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dashframe-seam-"));
    project = await openProject({ dir: join(root, "proj") });
  });

  afterEach(async () => {
    await project.close();
    rmSync(root, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // AC1 — Anti-shadow: the injected vault WINS over a caller-supplied vault key
  // ---------------------------------------------------------------------------

  it("anti-shadow: injected vault wins over a bogus vault key in call context", async () => {
    // Inject the real vault. The bogus vault has no connector-key backend and
    // would cause vault.store() to throw with a "no backend" error — a distinct
    // failure from the "no vault" throw the no-vault path produces.
    const { vault: injectedVault } = makeTestVault();
    const bogusVault = makeBogusVault();

    const app = await buildDashframeApp({
      db: project.db,
      vault: injectedVault,
    });

    // Pass the BOGUS vault in the call context — this simulates an attacker-
    // supplied or misconfigured context attempting to shadow the server vault.
    // If staticContext spread LAST, the injected vault wins and the call
    // succeeds (store → SecretRef). If merge order were reversed, bogusVault
    // would win and the call would throw with a "no backend" error.
    const id = await createSource(
      app,
      { type: "notion", name: "Shadow Test", apiKey: "plaintext-key" },
      { vault: bogusVault },
    );
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    // The call succeeded → the INJECTED vault was used (bogus would have thrown).
  });

  it("anti-shadow: bogus vault in context cannot shadow — injected vault identity is fixed", async () => {
    // Stronger form: verify the INJECTED vault's backend was actually called
    // (not the bogus vault). We check hasCallCount on the real backend.
    const { vault: injectedVault, backend: realBackend } = makeTestVault();
    const bogusVault = makeBogusVault();

    const app = await buildDashframeApp({
      db: project.db,
      vault: injectedVault,
    });

    // First store a credential via app.call with a bogus vault in context.
    const id = await createSource(
      app,
      { type: "notion", name: "Identity Test", apiKey: "my-key" },
      { vault: bogusVault },
    );

    // Now read it back — this calls vault.has(ref) on ctx.vault.
    await app.call("getDataSource", { id }, { vault: bogusVault });

    // The real backend was exercised for has() — not the bogus backend which
    // would have thrown or returned false (it never received a store call).
    expect(realBackend.hasCallCount).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // AC2 — Optional host capabilities may be omitted
  // ---------------------------------------------------------------------------

  it("assembles host context when optional vault and onWrite capabilities are omitted", async () => {
    // createDashframeServer delegates to buildDashframeApp with the same opts,
    // so this exercises the shared host-context path without optional
    // capabilities. An ordinary artifact call must still work.
    const app = await buildDashframeApp({ db: project.db });

    // No credential write — doesn't require vault.
    const id = await createSource(app, {
      type: "csv",
      name: "No Vault Source",
    });
    expect(typeof id).toBe("string");

    // Read it back.
    const { result: read } = await app.call("getDataSource", { id });
    expect((read as { name: string }).name).toBe("No Vault Source");
  });

  // ---------------------------------------------------------------------------
  // AC3 — vault threads into handlers: injected vault is visible on the call path
  // ---------------------------------------------------------------------------

  it("injected vault is visible to handlers (credential store via app.call succeeds)", async () => {
    // buildDashframeApp wraps both call and runHandler with the same merge.
    // This test confirms the injected vault is available to handlers on the
    // app.call path — a credential-bearing write that requires vault.store().
    // The runHandler wrapper uses the identical merge; direct runHandler coverage
    // would require a caller-supplied DrizzleTracker (low-level escape hatch).
    const { vault: injectedVault } = makeTestVault();
    const app = await buildDashframeApp({
      db: project.db,
      vault: injectedVault,
    });

    // Credential-bearing call — succeeds only if the vault was injected into context.
    const id = await createSource(app, {
      type: "notion",
      name: "Handler Vault Test",
      apiKey: "threaded-key",
    });
    expect(id).toBeTruthy();
  });

  it("rejects every public draft mutation dispatch before handler effects while preserving query overlays", async () => {
    const definition = functions.createDataSource;
    const originalHandler = definition.handler;
    let handlerDispatches = 0;
    definition.handler = async (
      ...args: Parameters<typeof originalHandler>
    ) => {
      handlerDispatches++;
      return originalHandler(...args);
    };
    const { vault } = makeTestVault();
    let storeCallCount = 0;
    let onWriteCalls = 0;
    const realStore = vault.store.bind(vault);
    vault.store = async (...args: Parameters<typeof vault.store>) => {
      storeCallCount++;
      return realStore(...args);
    };
    try {
      const app = await buildDashframeApp({
        db: project.db,
        vault,
        onWrite: () => onWriteCalls++,
      });
      const controller = createDraftController(app, project.db);
      const draftId = await controller.openDraft();
      const [metadataBefore] = await project.db
        .select()
        .from(schema.draftMetadata)
        .where(eq(schema.draftMetadata.draftId, draftId));
      const principal = { kind: "user" as const, userId: LOCAL_USER_ID };
      const context = { draftId, principal };
      const rejectedCallId = crypto.randomUUID();
      const rejectedRunHandlerId = crypto.randomUUID();
      const rejectedDraftTrackerId = crypto.randomUUID();
      const rejectedReplayId = crypto.randomUUID();
      const rejection =
        /Direct draft mutation "createDataSource" is not allowed; use draftBatch or DraftController\.appendToDraft/;

      await expect(
        app.call(
          "createDataSource",
          {
            id: rejectedCallId,
            type: "notion",
            name: "call must not reach handler",
            apiKey: "must-not-be-stored",
          },
          context,
        ),
      ).rejects.toThrow(rejection);
      await expect(
        app.runHandler(
          "createDataSource",
          {
            id: rejectedRunHandlerId,
            type: "notion",
            name: "runHandler must not reach handler",
            apiKey: "must-not-be-stored",
          },
          app.createTracked(),
          context,
        ),
      ).rejects.toThrow(rejection);
      await expect(
        app.runHandler(
          "createDataSource",
          {
            id: rejectedDraftTrackerId,
            type: "notion",
            name: "draft tracker must not reach handler",
            apiKey: "must-not-be-stored",
          },
          app.createTracked().withDraft(draftId),
          { principal },
        ),
      ).rejects.toThrow(rejection);

      const reflectedDispatchSymbol =
        Reflect.ownKeys(app).find(
          (key): key is symbol =>
            typeof key === "symbol" &&
            key.description === "dashframe.draftControllerDispatch",
        ) ?? Symbol("dashframe.draftControllerDispatch");
      const replayedAuthorization = {
        [reflectedDispatchSymbol]: Reflect.get(app, reflectedDispatchSymbol),
      };
      await expect(
        app.call(
          "createDataSource",
          {
            id: rejectedReplayId,
            type: "notion",
            name: "reflected capability replay must not reach handler",
            apiKey: "must-not-be-stored",
          },
          { ...context, ...replayedAuthorization },
        ),
      ).rejects.toThrow(rejection);
      expect(
        Reflect.ownKeys(app).some(
          (key) =>
            typeof key === "symbol" &&
            key.description === "dashframe.draftControllerDispatch",
        ),
      ).toBe(false);

      const rejectedShadows = await project.db
        .select()
        .from(schema.dataSourcesDraft)
        .where(eq(schema.dataSourcesDraft.draftId, draftId));
      const rejectedLog = await project.db
        .select()
        .from(schema.draftCommandLog)
        .where(eq(schema.draftCommandLog.draftId, draftId));
      const [metadataAfter] = await project.db
        .select()
        .from(schema.draftMetadata)
        .where(eq(schema.draftMetadata.draftId, draftId));
      expect(rejectedShadows).toHaveLength(0);
      expect(rejectedLog).toHaveLength(0);
      expect(metadataAfter).toEqual(metadataBefore);
      expect(handlerDispatches).toBe(0);
      expect(storeCallCount).toBe(0);
      expect(onWriteCalls).toBe(0);

      const draftedId = crypto.randomUUID();
      await controller.appendToDraft(
        draftId,
        [
          cmd("CreateDataSource", {
            id: draftedId,
            type: "csv",
            name: "query-visible draft",
          }),
        ],
        { principal },
      );
      expect(handlerDispatches).toBe(1);

      const { result: callQuery } = await app.call(
        "getDataSource",
        { id: draftedId },
        context,
      );
      const runHandlerQuery = await app.runHandler(
        "getDataSource",
        { id: draftedId },
        app.createTracked(),
        context,
      );
      const draftTrackerQuery = await app.runHandler(
        "getDataSource",
        { id: draftedId },
        app.createTracked().withDraft(draftId),
        { principal },
      );
      const { result: canonical } = await app.call("getDataSource", {
        id: draftedId,
      });
      const expectedDraft = expect.objectContaining({
        id: draftedId,
        name: "query-visible draft",
      });
      expect(callQuery).toEqual(expectedDraft);
      expect(runHandlerQuery).toEqual(expectedDraft);
      expect(draftTrackerQuery).toEqual(expectedDraft);
      expect(canonical).toBeNull();
    } finally {
      definition.handler = originalHandler;
    }
  });
});

describe("vault-backed serve-token auth", () => {
  /**
   * Acceptance test for the vault-backed auth path.
   *
   * Uses TestBackend (InMemoryMappingStore) — test environments only.
   * Proves: store → SecretRef → server resolves at gate →
   *   valid Bearer accepted, invalid Bearer rejected.
   *
   * This is a non-connector credential flowing through the same vault —
   * the class is "serve-token" (same class registered in Electron main for
   * the OS keychain).
   */
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;
  let vault: SecretVault;

  function buildTestVault(): SecretVault {
    const backend = new TestBackend();
    const registry = new SecretRegistry();
    registry.register("test", backend, { fallback: true });
    registry.setClassDefault(CREDENTIAL_CLASS.ServeToken, "test");
    return new SecretVault(registry, new InMemoryMappingStore());
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-vault-auth-"));
    project = null;
    server = null;
    vault = buildTestVault();
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves token from vault: valid Bearer → 200, no auth → 401, wrong token → 401", async () => {
    const plaintext = "vault-serve-token-test";
    const authRef = await vault.store(plaintext, {
      class: CREDENTIAL_CLASS.ServeToken,
    });

    project = await openProject({ dir: join(root, "proj"), name: "Vault Co" });
    server = await createDashframeServer({
      db: project.db,
      authRef,
      vault,
      corsOrigin: "null",
    });

    const url = `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`;

    // No auth header → 401
    const noAuth = await fetch(url);
    expect(noAuth.status).toBe(401);

    // Wrong token → 401
    const wrongAuth = await fetch(url, {
      headers: bearer("wrong-token"),
    });
    expect(wrongAuth.status).toBe(401);

    // Correct token → 200
    const ok = await fetch(url, {
      headers: bearer(plaintext),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { data: ProjectInfoResult };
    expect(body.data.name).toBe("Vault Co");
  });

  it("vault-backed resolver isolates per-request (token resolved fresh each time)", async () => {
    const plaintext = "rotating-token";
    const authRef = await vault.store(plaintext, {
      class: CREDENTIAL_CLASS.ServeToken,
    });

    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      authRef,
      vault,
    });

    const url = `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`;

    // Two successive correct-token requests both succeed — resolver is stateless
    // and re-reads from vault each time.
    for (let i = 0; i < 2; i++) {
      const res = await fetch(url, { headers: bearer(plaintext) });
      expect(res.status).toBe(200);
    }
  });

  it("denies a vault failure without falling through to a valid access credential", async () => {
    const accessCredentials = makeAccessCredentials(
      join(root, "access-credentials"),
    );
    const issued = await accessCredentials.issue("Automation client");
    const unresolvedAuthRef = makeSecretRef();

    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      authRef: unresolvedAuthRef,
      vault,
      accessCredentials,
    });

    const response = await fetch(
      `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`,
      { headers: bearer(issued.token) },
    );

    expect(response.status).toBe(401);
  });
});

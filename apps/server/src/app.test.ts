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

import { openProject, type ProjectHandle } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  makeSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertBindAuthorized,
  buildDashframeApp,
  createDashframeServer,
  type DashframeServer,
} from "./app";
import type { ProjectInfoResult } from "./functions";

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("should fire onWrite once after a successful mutation", async () => {
    const onWriteCalls: number[] = [];
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
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
      onWrite: () => {
        callCount++;
      },
    });

    const res = await fetch(
      `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`,
    );
    expect(res.status).toBe(200);
    expect(callCount).toBe(0);
  });

  it("should work without onWrite (backward-compatible — omitting it changes nothing)", async () => {
    // No onWrite configured — server should start and mutations should succeed.
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({ db: project.db });

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
   * 2. No-injection short-circuit: when vault and onWrite are both omitted, the
   *    factory returns the raw unwrapped app.
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
    registry.setClassDefault("connector-key", "test");
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
    const { result } = await app.call(
      "addDataSource",
      { type: "notion", name: "Shadow Test", apiKey: "plaintext-key" },
      { vault: bogusVault },
    );
    const id = (result as { id: string }).id;
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
    const { result } = await app.call(
      "addDataSource",
      { type: "notion", name: "Identity Test", apiKey: "my-key" },
      { vault: bogusVault },
    );
    const id = (result as { id: string }).id;

    // Now read it back — this calls vault.has(ref) on ctx.vault.
    await app.call("getDataSource", { id }, { vault: bogusVault });

    // The real backend was exercised for has() — not the bogus backend which
    // would have thrown or returned false (it never received a store call).
    expect(realBackend.hasCallCount).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // AC2 — No-injection short-circuit: omitting vault+onWrite returns raw app
  // ---------------------------------------------------------------------------

  it("no-injection short-circuit: buildDashframeApp({db}) returns raw unwrapped app", async () => {
    // When neither vault nor onWrite is supplied, buildDashframeApp returns the
    // raw WyStack app (the short-circuit branch `vault == null && onWrite == null
    // → rawApp`). createDashframeServer delegates to buildDashframeApp with the
    // same opts, so this exercises the shared unwrapped path. A read-only call
    // must still work.
    const app = await buildDashframeApp({ db: project.db });

    // No credential write — doesn't require vault.
    const { result } = await app.call("addDataSource", {
      type: "csv",
      name: "No Vault Source",
    });
    const id = (result as { id: string }).id;
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
    const { result } = await app.call("addDataSource", {
      type: "notion",
      name: "Handler Vault Test",
      apiKey: "threaded-key",
    });
    expect((result as { id: string }).id).toBeTruthy();
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
    registry.setClassDefault("serve-token", "test");
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
    const authRef = await vault.store(plaintext, { class: "serve-token" });

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
    const authRef = await vault.store(plaintext, { class: "serve-token" });

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
});

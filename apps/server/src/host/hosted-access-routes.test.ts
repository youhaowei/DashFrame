import { expect, it, vi } from "vite-plus/test";
import type { ApplicationOperations } from "./application";
import { createHostedAccessRoutes } from "./hosted-access-routes";
import type { HostedUserTokenSource } from "./hosted-token-issuer";

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function fixture(
  status: "signedout" | "unavailable" | "authenticated" = "authenticated",
  admissionStatus: "admitted" | "pending" | "revoked" = "admitted",
) {
  const session = {
    resolve: vi.fn(async () =>
      status === "authenticated"
        ? {
            status,
            identity: { subject: "verified-a" },
            expiresAt: Date.now() + 120_000,
            setCookie: "refreshed=opaque; Secure; HttpOnly",
          }
        : { status },
    ),
  };
  const admission = {
    resolve: vi.fn(async () =>
      admissionStatus === "admitted"
        ? { status: admissionStatus, workspaceId: "workspace-a" }
        : { status: admissionStatus, workspaceId: null },
    ),
  };
  const tokens = {
    browser: vi.fn(() => ({
      token: "synthetic-browser-only",
      expiresAt: Date.now() + 60_000,
    })),
  };
  const execute = vi.fn(async () => ({ ok: true }));
  const withWorkspace = vi.fn(
    async (
      _workspaceId: string,
      _user: HostedUserTokenSource,
      request: Request,
      operation: (
        application: Pick<ApplicationOperations, "execute">,
        signal: AbortSignal,
      ) => Promise<Response>,
    ) => operation({ execute }, request.signal),
  );
  const app = createHostedAccessRoutes({
    publicOrigin: "https://app.invalid",
    session,
    admission,
    tokens,
    withWorkspace,
  });
  const request = (route: string, origin = "https://app.invalid") =>
    app.request(`https://app.invalid/api/${route}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "attacker-selected",
        subject: "attacker-selected",
      }),
    });
  return { session, admission, tokens, withWorkspace, execute, app, request };
}

it.each(["signedout", "unavailable"] as const)(
  "does not resolve admission or open resources for %s",
  async (status) => {
    const f = fixture(status);
    const response = await f.request("runtime");
    expect(response.status).toBe(status === "signedout" ? 401 : 503);
    expect(f.admission.resolve).not.toHaveBeenCalled();
    expect(f.withWorkspace).not.toHaveBeenCalled();
    expect(f.tokens.browser).not.toHaveBeenCalled();
  },
);

it.each(["pending", "revoked"] as const)(
  "denies token issuance and runtime allocation for %s users",
  async (status) => {
    const f = fixture("authenticated", status);
    expect((await f.request("runtime")).status).toBe(200);
    expect((await f.request("convex-token")).status).toBe(403);
    expect(f.withWorkspace).not.toHaveBeenCalled();
    expect(f.tokens.browser).not.toHaveBeenCalled();
  },
);

it("uses only verified identity and admitted workspace, preserving refreshed cookies", async () => {
  const f = fixture();
  const response = await f.request("runtime");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Set-Cookie")).toContain("refreshed=opaque");
  expect(await response.json()).toEqual({
    mode: "hosted",
    status: "admitted",
    subject: "verified-a",
    workspaceId: "workspace-a",
    config: { convexUrl: "https://app.invalid/api/convex" },
  });
  expect(f.withWorkspace).toHaveBeenCalledWith(
    "workspace-a",
    expect.objectContaining({ userId: "verified-a" }),
    expect.any(Request),
    expect.any(Function),
  );
  expect(f.tokens.browser).not.toHaveBeenCalled();
  expect((await f.request("convex-token")).status).toBe(200);
  expect(f.tokens.browser).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "verified-a" }),
    "workspace-a",
  );
  expect(f.admission.resolve).toHaveBeenCalledTimes(2);
});

it("rejects foreign origins before authentication and maps startup failure to unavailable", async () => {
  const f = fixture();
  expect((await f.request("runtime", "https://foreign.invalid")).status).toBe(
    403,
  );
  expect(f.session.resolve).not.toHaveBeenCalled();
  f.withWorkspace.mockRejectedValueOnce(new Error("private startup detail"));
  const failed = await f.request("runtime");
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({
    mode: "hosted",
    status: "unavailable",
  });
  expect(f.tokens.browser).not.toHaveBeenCalled();
  expect((await f.app.request("https://app.invalid/api/runtime")).status).toBe(
    405,
  );
});

it("binds hosted operation dispatch to current admission and rejects unknown routes", async () => {
  const f = fixture();
  expect((await f.request("host/getAccessCapabilities")).status).toBe(200);
  expect(f.execute).toHaveBeenCalledWith(
    "getAccessCapabilities",
    expect.anything(),
    { principal: { kind: "user", userId: "verified-a" } },
  );
  expect((await f.request("host/notPublished")).status).toBe(404);
  expect(f.withWorkspace).toHaveBeenCalledTimes(1);
  for (const status of ["pending", "revoked"] as const) {
    const denied = fixture("authenticated", status);
    expect((await denied.request("host/getAccessCapabilities")).status).toBe(
      403,
    );
    expect(denied.execute).not.toHaveBeenCalled();
    expect(denied.withWorkspace).not.toHaveBeenCalled();
  }
  const foreign = fixture();
  expect(
    (
      await foreign.request(
        "host/getAccessCapabilities",
        "https://foreign.invalid",
      )
    ).status,
  ).toBe(403);
  expect(foreign.session.resolve).not.toHaveBeenCalled();
});

it("executes a hosted operation entirely inside the workspace lifetime", async () => {
  const f = fixture();
  const running = barrier();
  let active = false;
  f.withWorkspace.mockImplementationOnce(
    async (_workspaceId, _user, request, operation) => {
      active = true;
      try {
        return await operation({ execute: f.execute }, request.signal);
      } finally {
        active = false;
      }
    },
  );
  f.execute.mockImplementationOnce(async () => {
    expect(active).toBe(true);
    await running.promise;
    expect(active).toBe(true);
    return { ok: true };
  });
  const pending = f.request("host/getAccessCapabilities");
  await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce());
  expect(active).toBe(true);
  running.release();
  expect((await pending).status).toBe(200);
  expect(active).toBe(false);
});

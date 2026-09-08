import { expect, it, vi } from "vite-plus/test";
import { createHostedAccessRoutes } from "./hosted-access-routes";

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
  const ensureWorkspace = vi.fn(async () => ({ execute }));
  const app = createHostedAccessRoutes({
    publicOrigin: "https://app.invalid",
    session,
    admission,
    tokens,
    ensureWorkspace,
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
  return { session, admission, tokens, ensureWorkspace, execute, app, request };
}

it.each(["signedout", "unavailable"] as const)(
  "does not resolve admission or open resources for %s",
  async (status) => {
    const f = fixture(status);
    const response = await f.request("runtime");
    expect(response.status).toBe(status === "signedout" ? 401 : 503);
    expect(f.admission.resolve).not.toHaveBeenCalled();
    expect(f.ensureWorkspace).not.toHaveBeenCalled();
    expect(f.tokens.browser).not.toHaveBeenCalled();
  },
);

it.each(["pending", "revoked"] as const)(
  "denies token issuance and runtime allocation for %s users",
  async (status) => {
    const f = fixture("authenticated", status);
    expect((await f.request("runtime")).status).toBe(200);
    expect((await f.request("convex-token")).status).toBe(403);
    expect(f.ensureWorkspace).not.toHaveBeenCalled();
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
  expect(f.ensureWorkspace).toHaveBeenCalledWith(
    "workspace-a",
    expect.objectContaining({ userId: "verified-a" }),
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
  f.ensureWorkspace.mockRejectedValueOnce(new Error("private startup detail"));
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
  expect(f.ensureWorkspace).toHaveBeenCalledTimes(1);
  for (const status of ["pending", "revoked"] as const) {
    const denied = fixture("authenticated", status);
    expect((await denied.request("host/getAccessCapabilities")).status).toBe(
      403,
    );
    expect(denied.execute).not.toHaveBeenCalled();
    expect(denied.ensureWorkspace).not.toHaveBeenCalled();
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

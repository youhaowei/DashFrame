import { Hono, type Context } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { expect, it } from "vite-plus/test";
import { mountConvexProxy } from "./convex-proxy";

it("carries successful authorization headers into the upgrade response", async () => {
  const app = new Hono();
  const upgrade = (() => async (c: Context) =>
    c.text("upgraded")) as unknown as UpgradeWebSocket;
  const incoming = {};
  let applied: { request: object; headers: Headers } | undefined;
  mountConvexProxy(app, upgrade, "https://backend.invalid", {
    authorizeWebSocket: async () => ({
      headers: new Headers({
        "Set-Cookie": "__Host-session=rotated; Secure; HttpOnly",
      }),
    }),
    applyWebSocketHeaders: (request, headers) => {
      applied = { request, headers };
    },
  });

  const response = await app.request(
    "https://app.invalid/api/convex/api/1.0.0/sync",
    undefined,
    { incoming },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBe(
    "__Host-session=rotated; Secure; HttpOnly",
  );
  expect(applied?.request).toBe(incoming);
  expect(applied?.headers.get("set-cookie")).toBe(
    "__Host-session=rotated; Secure; HttpOnly",
  );
});

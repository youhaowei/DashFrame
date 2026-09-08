import { Hono } from "hono";
import type { HostedAdmission } from "./hosted-admission-service";
import type {
  HostedTokenIssuer,
  HostedUserTokenSource,
} from "./hosted-token-issuer";

type BrowserSession =
  | {
      status: "authenticated";
      identity: { subject: string };
      expiresAt: number;
      setCookie?: string;
    }
  | { status: "signedout"; setCookie?: string }
  | { status: "unavailable" };

/** Mount before legacy local routes. All callbacks are server-owned capabilities. */
export function createHostedAccessRoutes(options: {
  publicOrigin: string;
  session: { resolve(request: Request): Promise<BrowserSession> };
  admission: { resolve(user: HostedUserTokenSource): Promise<HostedAdmission> };
  tokens: Pick<HostedTokenIssuer, "browser">;
  /** Must finish workspace startup/recovery before exposing an admitted runtime. */
  ensureWorkspace(
    workspaceId: string,
    user: HostedUserTokenSource,
  ): Promise<void>;
}) {
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== options.publicOrigin)
    throw new Error("Hosted access requires an exact HTTPS public origin");
  const convexUrl = `${origin.origin}/api/convex`;
  const app = new Hono();
  app.get("/api/runtime", (c) => c.json({ error: "Use POST" }, 405));

  for (const target of ["runtime", "convex-token"] as const) {
    app.post(`/api/${target}`, async (c) => {
      c.header("Cache-Control", "no-store");
      if (c.req.header("origin") !== origin.origin)
        return c.json({ error: "Origin is not allowed" }, 403);
      const state = (
        status: "signed-out" | "pending" | "revoked" | "unavailable",
      ) =>
        target === "runtime" ? { mode: "hosted" as const, status } : { status };
      try {
        const session = await options.session.resolve(c.req.raw);
        if ("setCookie" in session && session.setCookie)
          c.header("Set-Cookie", session.setCookie);
        if (session.status === "unavailable")
          return c.json(state("unavailable"), 503);
        if (session.status === "signedout")
          return c.json(state("signed-out"), 401);
        const user = {
          userId: session.identity.subject,
          expiresAt: session.expiresAt,
        };
        const admission = await options.admission.resolve(user);
        if (admission.status !== "admitted")
          return c.json(
            state(admission.status),
            target === "runtime" ? 200 : 403,
          );
        await options.ensureWorkspace(admission.workspaceId, user);
        if (target === "convex-token")
          return c.json(options.tokens.browser(user, admission.workspaceId));
        return c.json({
          mode: "hosted",
          status: "admitted",
          subject: user.userId,
          workspaceId: admission.workspaceId,
          config: { convexUrl },
        });
      } catch {
        // Provider and startup failures must never become a local-mode fallback
        // or an invented authentication rejection. Do not expose their details.
        return c.json(state("unavailable"), 503);
      }
    });
  }
  return app;
}

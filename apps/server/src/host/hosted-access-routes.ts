import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_LOCAL_ARROW_BYTES } from "@dashframe/types";
import type { ApplicationOperations } from "./application";
import { hostOperationByName } from "./registry";
import { HostBatchOutcomeUnknownError } from "./commands";
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
  ): Promise<Pick<ApplicationOperations, "execute">>;
}) {
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== options.publicOrigin)
    throw new Error("Hosted access requires an exact HTTPS public origin");
  const convexUrl = `${origin.origin}/api/convex`;
  const app = new Hono();
  app.get("/api/runtime", (c) => c.json({ error: "Use POST" }, 405));

  app.use(
    "/api/host/*",
    bodyLimit({
      maxSize: Math.ceil((MAX_LOCAL_ARROW_BYTES * 4) / 3) + 1024 * 1024,
    }),
  );
  for (const target of ["runtime", "convex-token", "operation"] as const) {
    app.post(
      target === "operation" ? "/api/host/:operation" : `/api/${target}`,
      async (c) => {
        c.header("Cache-Control", "no-store");
        if (c.req.header("origin") !== origin.origin)
          return c.json({ error: "Origin is not allowed" }, 403);
        const state = (
          status: "signed-out" | "pending" | "revoked" | "unavailable",
        ) =>
          target === "runtime"
            ? { mode: "hosted" as const, status }
            : { status };
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
          const operation =
            target === "operation" ? c.req.param("operation") : undefined;
          if (
            target === "operation" &&
            (!operation || !hostOperationByName(operation))
          )
            return c.json({ error: "Unknown host operation" }, 404);
          const application = await options.ensureWorkspace(
            admission.workspaceId,
            user,
          );
          if (target === "operation")
            return executeHostedOperation(
              c,
              application,
              operation!,
              user.userId,
            );
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
      },
    );
  }
  return app;
}

async function executeHostedOperation(
  c: Context,
  application: Pick<ApplicationOperations, "execute">,
  operation: string,
  userId: string,
): Promise<Response> {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON input" }, 400);
  }
  try {
    return c.json(
      await application.execute(operation, input, {
        principal: { kind: "user", userId: userId },
      }),
    );
  } catch (error) {
    if (error instanceof HostBatchOutcomeUnknownError)
      return c.json(
        {
          error: error.message,
          code: error.code,
          operationId: error.operationId,
        },
        503,
      );
    if (error instanceof Error && error.message === "FORBIDDEN")
      return c.json({ error: "Forbidden" }, 403);
    return c.json({ error: "Host operation failed" }, 400);
  }
}

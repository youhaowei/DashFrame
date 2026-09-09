import { Hono } from "hono";
import { createHostedAccessRoutes } from "./hosted-access-routes";
import type { createHostedWorkOSSession } from "./hosted-workos-session";

type AccessOptions = Parameters<typeof createHostedAccessRoutes>[0];

/** Hosted HTTP boundary. Supply an admitted workspace factory; never mount local routes here. */
export function createHostedHttpApplication(
  options: Omit<AccessOptions, "session"> & {
    session: ReturnType<typeof createHostedWorkOSSession>;
  },
) {
  const app = new Hono();
  app.use("/auth/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.onError((_error, c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ error: "Hosted service unavailable" }, 503);
  });
  app.get("/auth/login", () => options.session.login());
  app.get("/auth/callback", (c) => options.session.callback(c.req.raw));
  app.post("/auth/logout", (c) => options.session.logout(c.req.raw));
  app.route("/", createHostedAccessRoutes(options));
  return app;
}

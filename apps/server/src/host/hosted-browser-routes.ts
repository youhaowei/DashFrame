import { Hono } from "hono";
import { createArrowDataPath } from "@dashframe/engine-server/arrow-data-path";
import { handleAssistantRunRequest } from "../assistant-run-route";
import {
  handleConnectorOAuthCallback,
  handleConnectorSetupResume,
  handleConnectorResumeLanding,
} from "../connector-oauth-callback";
import { createHostedHttpApplication } from "./hosted-http-application";
import { isHostedOriginAllowed } from "./hosted-origin";
import type { createHostedApplication } from "./hosted-application";
import type { createHostedWorkOSSession } from "./hosted-workos-session";
import type { createHostedAdmissionService } from "./hosted-admission-service";
import type { WithHostedContext } from "./hosted-route-context";

function runHostedAssistant(
  request: Request,
  hosted: ReturnType<typeof createHostedApplication>,
  signal: AbortSignal,
) {
  const assistant = new Hono();
  assistant.post("/assistant/run", (context) =>
    handleAssistantRunRequest(context, {
      app: hosted.application,
      metadata: hosted.context.metadata,
      vault: hosted.context.vault,
      resolveContext: async () => ({ principal: hosted.context.principal }),
    }),
  );
  return assistant.fetch(new Request(request, { signal }));
}

export function mountHostedBrowserRoutes(
  app: Hono,
  options: {
    publicOrigin: string;
    session: ReturnType<typeof createHostedWorkOSSession>;
    admission: ReturnType<typeof createHostedAdmissionService>;
    tokens: Parameters<typeof createHostedApplication>[0]["tokens"];
    withHostedContext: WithHostedContext;
  },
) {
  const { publicOrigin, session, admission, tokens, withHostedContext } =
    options;
  for (const route of ["/api/*", "/data/*", "/assistant/*"]) {
    app.use(route, async (c, next) => {
      if (!isHostedOriginAllowed(c.req.raw, publicOrigin))
        return c.json({ error: "Origin is not allowed" }, 403);
      await next();
    });
  }
  app.route(
    "/",
    createHostedHttpApplication({
      publicOrigin,
      session,
      admission,
      tokens,
      withWorkspace: (workspaceId, user, request, operation) =>
        withHostedContext(workspaceId, user, request, (hosted, signal) =>
          operation(hosted.application, signal),
        ),
    }),
  );
  const authenticated = async (
    request: Request,
    operation: (
      hosted: ReturnType<typeof createHostedApplication>,
      signal: AbortSignal,
    ) => Promise<Response>,
  ): Promise<Response> => {
    let cookie: string | undefined;
    try {
      const identity = await session.resolve(request);
      if ("setCookie" in identity) cookie = identity.setCookie;
      let response: Response;
      if (identity.status !== "authenticated") {
        response = Response.json(
          { error: "Authentication unavailable" },
          {
            status: identity.status === "signedout" ? 401 : 503,
          },
        );
      } else {
        const user = {
          userId: identity.identity.subject,
          expiresAt: identity.expiresAt,
        };
        const access = await admission.resolve(user);
        response =
          access.status === "admitted"
            ? await withHostedContext(
                access.workspaceId,
                user,
                request,
                operation,
              )
            : Response.json({ error: "Admission required" }, { status: 403 });
      }
      response.headers.set("Cache-Control", "no-store");
      if (cookie) response.headers.append("Set-Cookie", cookie);
      return response;
    } catch {
      return Response.json(
        { error: "Hosted service unavailable" },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            ...(cookie ? { "Set-Cookie": cookie } : {}),
          },
        },
      );
    }
  };
  app.all("/data/*", (c) =>
    authenticated(c.req.raw, async (hosted, signal) => {
      const data = createArrowDataPath({
        engine: hosted.context.dataPlaneRuntime!,
        dataFrameStorage: hosted.context.dataFrameStorage,
        authorizeRequest: async () => {
          signal.throwIfAborted();
          return true;
        },
        isFrameAvailable: async (id) => {
          const frame = await hosted.context.metadata.getDataFrame(id);
          const storage = frame?.storage;
          return storage?.type === "file" && storage.key === id;
        },
      });
      const url = new URL(c.req.url);
      const target = new URL(
        url.pathname.slice("/data".length) + url.search,
        publicOrigin,
      );
      return data.fetch(
        new Request(target, new Request(c.req.raw, { signal })),
      );
    }),
  );
  app.post("/assistant/run", (c) =>
    authenticated(c.req.raw, async (hosted, signal) =>
      runHostedAssistant(c.req.raw, hosted, signal),
    ),
  );
  app.get("/api/connectors/oauth/callback", (c) =>
    authenticated(c.req.raw, async (hosted) =>
      handleConnectorOAuthCallback(c, hosted.application),
    ),
  );
  app.get("/api/connectors/setup/:sessionId/resume", (c) =>
    authenticated(c.req.raw, async (hosted) =>
      handleConnectorSetupResume(c, hosted.application),
    ),
  );
  app.get("/", (c, next) =>
    c.req.query("resumeConnector")
      ? authenticated(c.req.raw, async (hosted) =>
          handleConnectorResumeLanding(c, hosted.application),
        )
      : next(),
  );
}

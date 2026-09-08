import { Hono } from "hono";
import { createMcpRoute } from "../mcp/route";
import type { HostedPrincipalTokenSource } from "./hosted-token-issuer";
import type { createHostedServiceAccess } from "./hosted-service-access";
import type { createHostedWorkspaceResourceFactory } from "./hosted-workspace-resources";
import type { WithPrincipalContext } from "./hosted-route-context";

export function mountHostedMcpRoutes(
  app: Hono,
  options: {
    publicOrigin: string;
    authenticateCredential?: Awaited<
      ReturnType<typeof createHostedWorkspaceResourceFactory>
    >["authenticateCredential"];
    serviceAccess: ReturnType<typeof createHostedServiceAccess>;
    withPrincipalContext: WithPrincipalContext;
  },
) {
  const {
    publicOrigin,
    authenticateCredential,
    serviceAccess,
    withPrincipalContext,
  } = options;
  app.all("/workspaces/:workspaceId/mcp", async (c) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("Origin");
    if (origin && origin !== publicOrigin)
      return c.json({ error: "Origin is not allowed" }, 403);
    const bearer = /^Bearer (dfa_[a-z0-9_-]+)$/i.exec(
      c.req.header("Authorization") ?? "",
    );
    if (!bearer) return c.json({ error: "Unauthorized MCP request" }, 401);
    if (!authenticateCredential)
      return c.json({ error: "Agent access unavailable" }, 503);
    const workspaceId = c.req.param("workspaceId");
    let source: HostedPrincipalTokenSource;
    let ownerId: string;
    try {
      const credentialId = await authenticateCredential(
        workspaceId,
        bearer[1]!,
      );
      if (!credentialId)
        return c.json({ error: "Unauthorized MCP request" }, 401);
      source = {
        kind: "service",
        credentialId,
        expiresAt: Date.now() + 60_000,
      };
      const binding = await serviceAccess.resolve(workspaceId, source);
      if (
        binding.workspaceId !== workspaceId ||
        binding.credentialId !== credentialId
      )
        return c.json({ error: "Unauthorized MCP request" }, 401);
      ownerId = binding.subject;
    } catch {
      return c.json({ error: "Unauthorized MCP request" }, 401);
    }
    try {
      return await withPrincipalContext(
        workspaceId,
        ownerId,
        source,
        c.req.raw,
        async (hosted, signal) => {
          const mcp = new Hono();
          mcp.all(
            "*",
            createMcpRoute({
              app: hosted.application,
              mode: "stateless",
              resolveContext: async () => ({
                principal: hosted.context.principal,
              }),
            }),
          );
          return mcp.fetch(new Request(c.req.raw, { signal }));
        },
      );
    } catch {
      return c.json({ error: "Agent request unavailable" }, 503);
    }
  });
}

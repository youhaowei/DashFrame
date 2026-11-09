import { ConvexError } from "convex/values";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@dashframe/convex-backend/api";
import { validateHostedDeploymentUrl } from "./hosted-deployment-url";
import type {
  HostedTokenIssuer,
  HostedUserTokenSource,
} from "./hosted-token-issuer";

export type EnsuredAgentGrant =
  | { status: "active"; grantId: string }
  | { status: "revoked" };

/** Call only with a subject verified from an AuthKit token and its admitted workspace. */
export function createHostedAgentGrants(options: {
  deploymentUrl: string;
  tokens: Pick<HostedTokenIssuer, "agentGrant">;
  allowInsecureLoopbackForTests?: boolean;
}) {
  const deploymentUrl = validateHostedDeploymentUrl(
    options.deploymentUrl,
    options.allowInsecureLoopbackForTests,
  );
  return {
    async ensure(
      user: HostedUserTokenSource,
      workspaceId: string,
      clientKey: string,
      issuedAt: number,
    ): Promise<EnsuredAgentGrant> {
      const client = new ConvexHttpClient(deploymentUrl);
      client.setAuth(options.tokens.agentGrant(user, workspaceId).token);
      try {
        const grant = await client.mutation(api.agentGrants.ensureOAuthGrant, {
          clientKey,
          issuedAt,
        });
        return { status: "active", grantId: grant.grantId };
      } catch (error) {
        if (
          error instanceof ConvexError &&
          error.data === "Agent grant revoked"
        )
          return { status: "revoked" };
        throw error;
      }
    },
  };
}

export type HostedAgentGrants = ReturnType<typeof createHostedAgentGrants>;

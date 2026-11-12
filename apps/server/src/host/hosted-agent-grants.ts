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
  | { status: "revoked" }
  /** The backend refused this grant for a reason a retry cannot change. */
  | { status: "refused" };

/** The one Convex denial from `ensureOAuthGrant` that a retry can clear. */
const ALLOCATION_CONFLICT = "Agent grant allocation conflict; retry";

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
    ): Promise<EnsuredAgentGrant> {
      const client = new ConvexHttpClient(deploymentUrl);
      client.setAuth(options.tokens.agentGrant(user, workspaceId).token);
      try {
        const grant = await client.mutation(api.agentGrants.ensureOAuthGrant, {
          clientKey,
        });
        return { status: "active", grantId: grant.grantId };
      } catch (error) {
        // Anything that is not a Convex denial is a transport fault: our
        // outage, reported as such so the client retries.
        if (
          !(error instanceof ConvexError) ||
          error.data === ALLOCATION_CONFLICT
        )
          throw error;
        if (error.data === "Agent grant revoked") return { status: "revoked" };
        return { status: "refused" };
      }
    },
  };
}

export type HostedAgentGrants = ReturnType<typeof createHostedAgentGrants>;

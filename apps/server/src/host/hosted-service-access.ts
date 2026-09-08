import { ConvexHttpClient } from "convex/browser";
import { api } from "@dashframe/convex-backend/api";
import { validateHostedDeploymentUrl } from "./hosted-deployment-url";
import type {
  HostedTokenIssuer,
  HostedCredentialTokenSource,
} from "./hosted-token-issuer";

/** Call only after verifying the bearer against the requested workspace's host store. */
export function createHostedServiceAccess(options: {
  deploymentUrl: string;
  tokens: Pick<HostedTokenIssuer, "metadata">;
  allowInsecureLoopbackForTests?: boolean;
}) {
  const deploymentUrl = validateHostedDeploymentUrl(
    options.deploymentUrl,
    options.allowInsecureLoopbackForTests,
  );
  return {
    async resolve(
      workspaceId: string,
      credential: HostedCredentialTokenSource,
    ) {
      const client = new ConvexHttpClient(deploymentUrl);
      client.setAuth(
        options.tokens.metadata({ kind: "service", ...credential }, workspaceId)
          .token,
      );
      return client.query(api.hostedCredentials.resolveService, {});
    },
  };
}

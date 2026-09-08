import { api } from "@dashframe/convex-backend/api";
import { createHostedMetadataClient } from "./hosted-convex-metadata";
import { validateHostedDeploymentUrl } from "./hosted-deployment-url";
import type {
  HostedTokenIssuer,
  HostedUserTokenSource,
} from "./hosted-token-issuer";

export type HostedAdmission =
  | { status: "admitted"; workspaceId: string }
  | { status: "pending" | "revoked"; workspaceId: null };

/** Caller supplies a verified WorkOS identity, never a request-body subject. */
export function createHostedAdmissionService(options: {
  deploymentUrl: string;
  tokens: Pick<HostedTokenIssuer, "admission">;
  allowInsecureLoopbackForTests?: boolean;
}) {
  const deploymentUrl = validateHostedDeploymentUrl(
    options.deploymentUrl,
    options.allowInsecureLoopbackForTests,
  );
  return {
    async resolve(user: HostedUserTokenSource): Promise<HostedAdmission> {
      const client = await createHostedMetadataClient({
        deploymentUrl,
        allowInsecureLoopbackForTests: options.allowInsecureLoopbackForTests,
        getToken: async () => options.tokens.admission(user).token,
      })();
      // This transaction rechecks current admission and allocates at most one
      // canonical workspace. No local runtime, directory or vault is opened here.
      const result = await client.mutation(api.admission.resolve, {});
      if (
        result.status === "admitted" &&
        typeof result.workspaceId === "string" &&
        result.workspaceId.length > 0 &&
        result.workspaceId.trim() === result.workspaceId
      )
        return { status: "admitted", workspaceId: result.workspaceId };
      if (
        (result.status === "pending" || result.status === "revoked") &&
        result.workspaceId === null
      )
        return { status: result.status, workspaceId: null };
      throw new Error("Invalid hosted admission response");
    },
  };
}

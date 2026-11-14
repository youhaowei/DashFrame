import { api } from "@dashframe/convex-backend/api";
import { ConvexHttpClient } from "convex/browser";
import { validateHostedDeploymentUrl } from "./hosted-deployment-url";

export interface HostedCredentialOwnership {
  register(credentialId: string): Promise<{
    credentialId: string;
    subject: string;
    workspaceId: string;
  }>;
  revoke(credentialId: string): Promise<void>;
  /** Every OAuth agent grant in the owner's workspace, oldest first. */
  listAgentGrants(): Promise<AgentGrantSummary[]>;
  revokeAgentGrant(grantId: string): Promise<void>;
}

export interface AgentGrantSummary {
  grantId: string;
  clientKey: string;
  permissions: string[];
  createdAt: number;
  revokedAt: number | null;
}

/**
 * The signer binds the verified user and admitted workspace to host-credentials.
 * The host must register before exposing/accepting a token, and revoke metadata
 * before its local store. Failures propagate so orchestration can fail closed.
 */
export function createHostedCredentialOwnership(options: {
  deploymentUrl: string;
  getToken: () => Promise<string>;
  /** Disposable native backend tests only; permits literal 127.0.0.1 HTTP. */
  allowInsecureLoopbackForTests?: boolean;
}): HostedCredentialOwnership {
  const deploymentUrl = validateHostedDeploymentUrl(
    options.deploymentUrl,
    options.allowInsecureLoopbackForTests === true,
  );
  async function client() {
    // Auth is mutable on ConvexHttpClient. Never share it between operations.
    const result = new ConvexHttpClient(deploymentUrl);
    result.setAuth(await options.getToken());
    return result;
  }
  return {
    register: async (credentialId) =>
      (await client()).mutation(api.hostedCredentials.register, {
        credentialId,
      }),
    revoke: async (credentialId) => {
      await (
        await client()
      ).mutation(api.hostedCredentials.revoke, { credentialId });
    },
    listAgentGrants: async () => {
      const convex = await client();
      const grants: AgentGrantSummary[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page: {
          page: AgentGrantSummary[];
          isDone: boolean;
          continueCursor: string;
        } = await convex.query(api.agentGrants.listGrants, {
          paginationOpts: { cursor, numItems: 100 },
        });
        grants.push(...page.page);
        if (page.isDone) return grants;
        cursor = page.continueCursor;
      }
    },
    revokeAgentGrant: async (grantId) => {
      await (await client()).mutation(api.agentGrants.revokeGrant, { grantId });
    },
  };
}

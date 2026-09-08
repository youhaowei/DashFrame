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
  };
}

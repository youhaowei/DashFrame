import { isPrincipal, type Principal } from "@wystack/identity";
import type { ConnectorSetupStore } from "../connector-setup/session-store";
import { bindHostedMetadata } from "./bound-hosted-metadata";
import type { HostContext } from "./context";
import { createApplicationOperations } from "./dispatch";
import { createHostedProviderMetadata } from "./hosted-convex-provider-metadata";
import { createHostedCredentialOwnership } from "./hosted-credential-ownership";
import { validateHostedDeploymentUrl } from "./hosted-deployment-url";
import type {
  HostedPrincipalTokenSource,
  HostedTokenIssuer,
} from "./hosted-token-issuer";
import { HostResourceCleanup } from "./resource-cleanup";
import { createHostedAccessCredentials } from "./hosted-access-credentials";

type WorkspaceResources = Pick<
  HostContext,
  | "vault"
  | "accessCredentials"
  | "getServerEndpoint"
  | "dataFrameStorage"
  | "dataPlaneRuntime"
  | "googleOAuth"
> & {
  vault: NonNullable<HostContext["vault"]>;
  connectorSetup: ConnectorSetupStore;
};

/** Construct once per verified request using the admitted workspace's owned resources.
 * This does not authenticate requests or acquire the workspace startup lock. */
export function createHostedApplication(options: {
  deploymentUrl: string;
  allowInsecureLoopbackForTests?: boolean;
  source: HostedPrincipalTokenSource;
  workspaceId: string;
  workspaceOwnerId: string;
  tokens: Pick<
    HostedTokenIssuer,
    "browser" | "service" | "metadata" | "credentialOwnership"
  >;
  resources: WorkspaceResources;
}) {
  const deploymentUrl = validateHostedDeploymentUrl(
    options.deploymentUrl,
    options.allowInsecureLoopbackForTests,
  );
  const source = { ...options.source };
  const workspaceId = identifier(options.workspaceId);
  const workspaceOwnerId = identifier(options.workspaceOwnerId);
  if (!Number.isFinite(source.expiresAt) || source.expiresAt <= Date.now())
    throw new Error("Verified caller expired");
  const principal: Principal =
    source.kind === "user"
      ? { kind: "user", userId: identifier(source.userId) }
      : { kind: "service", credentialId: identifier(source.credentialId) };
  if (principal.kind === "user" && principal.userId !== workspaceOwnerId)
    throw new Error("FORBIDDEN");
  const resources = { ...options.resources };
  const tokens = options.tokens;
  function requireBound(candidate: Principal) {
    if (
      !isPrincipal(candidate) ||
      candidate.kind !== principal.kind ||
      (candidate.kind === "user"
        ? principal.kind !== "user" || candidate.userId !== principal.userId
        : principal.kind !== "service" ||
          candidate.credentialId !== principal.credentialId)
    )
      throw new Error("FORBIDDEN");
  }
  const hostedMetadata = createHostedProviderMetadata({
    deploymentUrl,
    allowInsecureLoopbackForTests: options.allowInsecureLoopbackForTests,
    credentialVault: resources.vault,
    getToken: async () => tokens.metadata(source, workspaceId).token,
  });
  const ownership = createHostedCredentialOwnership({
    deploymentUrl,
    allowInsecureLoopbackForTests: options.allowInsecureLoopbackForTests,
    getToken: async () => {
      if (source.kind !== "user") throw new Error("FORBIDDEN");
      return tokens.credentialOwnership(source, workspaceId).token;
    },
  });
  const metadata = bindHostedMetadata({
    principal,
    metadata: hostedMetadata,
    connectorSetup: resources.connectorSetup,
    credentialOwnership: ownership,
  });
  const cleanup = new HostResourceCleanup({
    ...resources,
    metadata: hostedMetadata,
  });
  const context: HostContext = {
    ...resources,
    accessCredentials: resources.accessCredentials
      ? createHostedAccessCredentials(resources.accessCredentials, ownership)
      : undefined,
    principal,
    workspaceOwnerId,
    metadata,
    cleanupResources: () => cleanup.run(),
  };
  const application = createApplicationOperations({
    convexUrl: deploymentUrl,
    identity: {
      issue(candidate) {
        requireBound(candidate);
        return source.kind === "user"
          ? tokens.browser(source, workspaceId)
          : tokens.service(source, workspaceId);
      },
    },
    context(candidate) {
      requireBound(candidate);
      return { ...context, principal: candidate };
    },
  }).forPrincipal(principal);
  return { application, context, cleanup };
}

function identifier(value: string): string {
  if (!value || value.trim() !== value || /[\s\p{Cc}]/u.test(value))
    throw new Error("Invalid admitted identity");
  return value;
}

import { isPrincipal, type Principal } from "@wystack/identity";
import type { ConnectorSetupStore } from "../connector-setup/session-store";
import type { HostedProviderMetadata } from "./hosted-convex-provider-metadata";
import type { HostedCredentialOwnership } from "./hosted-credential-ownership";
import type { HostMetadata } from "./metadata";

/** Adapt request-bound hosted capabilities without forwarding caller identity in JSON. */
export function bindHostedMetadata(options: {
  principal: Principal;
  metadata: HostedProviderMetadata;
  connectorSetup: ConnectorSetupStore;
  credentialOwnership: Pick<HostedCredentialOwnership, "revoke">;
}): HostMetadata {
  if (!isPrincipal(options.principal))
    throw new Error("Verified principal required");
  const bound = { ...options.principal };
  const metadata = options.metadata;
  function requireBound(principal: Principal) {
    if (
      !isPrincipal(principal) ||
      principal.kind !== bound.kind ||
      (principal.kind === "user"
        ? bound.kind !== "user" || principal.userId !== bound.userId
        : bound.kind !== "service" ||
          principal.credentialId !== bound.credentialId)
    )
      throw new Error("FORBIDDEN");
  }
  return {
    ...metadata,
    connectorSetup: options.connectorSetup,
    commitBatch: async (principal, commands) => {
      requireBound(principal);
      return metadata.commitBatch(commands);
    },
    draftBatch: async (principal, commands, draftId) => {
      requireBound(principal);
      return metadata.draftBatch(commands, draftId);
    },
    prepareHostBatch: async ({ principal, ...input }) => {
      requireBound(principal);
      return metadata.prepareHostBatch(input);
    },
    executeHostBatch: async ({ principal, ...input }) => {
      requireBound(principal);
      return metadata.executeHostBatch(input);
    },
    getHostBatch: async ({ principal, ...input }) => {
      requireBound(principal);
      return metadata.getHostBatch(input);
    },
    settleHostBatch: async ({ principal, ...input }) => {
      requireBound(principal);
      return metadata.settleHostBatch(input);
    },
    commitImportedFrame: async (input) => {
      const { operationId, requestHash, expectedDataSourceRevision } = input;
      if (
        !operationId ||
        !requestHash ||
        expectedDataSourceRevision === undefined
      )
        throw new Error(
          "Hosted import requires a durable claim and source revision",
        );
      await metadata.commitImportedFrame({
        ...input,
        operationId,
        requestHash,
        expectedDataSourceRevision,
      });
    },
    revokeCredential: async (credentialId) => {
      if (bound.kind !== "user") throw new Error("FORBIDDEN");
      await options.credentialOwnership.revoke(credentialId);
    },
  };
}

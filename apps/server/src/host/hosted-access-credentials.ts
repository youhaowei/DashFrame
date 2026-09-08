import type { HostContext } from "./context";
import type { HostedCredentialOwnership } from "./hosted-credential-ownership";

/** Publish ownership before returning a newly issued bearer token to its owner. */
export function createHostedAccessCredentials(
  store: NonNullable<HostContext["accessCredentials"]>,
  ownership: Pick<HostedCredentialOwnership, "register">,
): NonNullable<HostContext["accessCredentials"]> {
  return {
    list: () => store.list(),
    revoke: (id) => store.revoke(id),
    async issue(name) {
      const issued = await store.issue(name);
      try {
        await ownership.register(issued.credential.id);
      } catch (error) {
        // The token was never exposed. Retire its verifier if registration failed
        // or its acknowledgement was lost; a retry issues a fresh credential.
        await store.revoke(issued.credential.id);
        throw error;
      }
      return issued;
    },
  };
}

import type { Principal } from "@wystack/identity";

/** Host-owned application boundary used by assistant and MCP tools. */
export interface ApplicationOperations {
  execute(
    operation: string,
    input: unknown,
    context?: {
      principal?: unknown;
      draftId?: string;
      operationId?: string;
    },
  ): Promise<unknown>;
  forPrincipal(principal: Principal): ApplicationOperations;
}

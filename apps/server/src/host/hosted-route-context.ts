import type { createHostedApplication } from "./hosted-application";
import type {
  HostedPrincipalTokenSource,
  HostedUserTokenSource,
} from "./hosted-token-issuer";

export type HostedOperation = (
  hosted: ReturnType<typeof createHostedApplication>,
  signal: AbortSignal,
) => Promise<Response>;
export type WithPrincipalContext = (
  workspaceId: string,
  ownerId: string,
  source: HostedPrincipalTokenSource,
  request: Request,
  operation: HostedOperation,
) => Promise<Response>;
export type WithHostedContext = (
  workspaceId: string,
  user: HostedUserTokenSource,
  request: Request,
  operation: HostedOperation,
) => Promise<Response>;

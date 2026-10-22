import { HostOperationError, requestHost } from "@/data/host";
import { openOAuthAuthorizationUrl } from "@/lib/oauth-authorization-target";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1_000;

/**
 * Ownership handle for an in-flight OAuth poll.
 *
 * The poll outlives the click that started it — up to POLL_TIMEOUT_MS — so the
 * component needs a way to stop it on unmount. Without one the loop keeps
 * querying the server for fifteen minutes after the component is gone and then
 * calls onConnected on a tree that no longer exists.
 */
export interface PollToken {
  cancelled: boolean;
  activityHeld: boolean;
  activityTransferred: boolean;
  timer?: number;
}

export function newPollToken(): PollToken {
  return { cancelled: false, activityHeld: false, activityTransferred: false };
}

/** Stop a poll that is waiting between requests. */
export function cancelPoll(token: PollToken): void {
  token.cancelled = true;
  if (token.timer !== undefined) window.clearTimeout(token.timer);
}

export interface OAuthSetupRequest {
  connectorId: string;
  requestedName: string;
  /** Renew this source's sign-in instead of creating a new source. */
  reconnectDataSourceId?: string;
}

function waitForPoll(token: PollToken): Promise<void> {
  return new Promise((resolve) => {
    token.timer = window.setTimeout(resolve, POLL_INTERVAL_MS);
  });
}

/**
 * Interpret one poll result. Returns true when the flow has reached a terminal
 * state and the loop should stop; throws when that state is a failure.
 */
async function settleOAuthPoll(
  current: { state: string; dataSourceId?: string; failureMessage?: string },
  onConnected: (dataSourceId: string) => Promise<void>,
  token: PollToken,
): Promise<boolean> {
  if (current.state === "connected") {
    if (!current.dataSourceId) {
      throw new Error("Connected source id is missing");
    }
    token.activityTransferred = true;
    await onConnected(current.dataSourceId);
    return true;
  }
  if (current.state === "failed" || current.state === "expired") {
    throw new OAuthSetupError(
      current.failureMessage ?? "Google sign-in didn't finish. Try again.",
    );
  }
  return false;
}

async function pollOAuthCompletion(
  sessionId: string,
  onConnected: (dataSourceId: string) => Promise<void>,
  token: PollToken,
): Promise<void> {
  for (
    let elapsed = 0;
    elapsed < POLL_TIMEOUT_MS;
    elapsed += POLL_INTERVAL_MS
  ) {
    await waitForPoll(token);
    if (token.cancelled) return;
    const current = await requestHost("getConnectorSetupSession", {
      sessionId,
    });
    // Checked again after the round trip: the component can unmount while the
    // query is in flight, and onConnected updates parent state.
    if (token.cancelled) return;
    if (await settleOAuthPoll(current, onConnected, token)) return;
  }
  throw new Error("Google authorization timed out");
}

/** An OAuth setup failure whose message is written for the person connecting. */
export class OAuthSetupError extends Error {}

/**
 * Only messages meant for people reach the screen: the server's own setup
 * rejection or the session's recorded failure. Network and parse failures keep
 * the generic copy.
 */
export function oauthSetupErrorMessage(error: unknown): string | undefined {
  return error instanceof OAuthSetupError ? error.message : undefined;
}

async function startSetup(request: OAuthSetupRequest) {
  try {
    return await requestHost("startConnectorSetup", request);
  } catch (error) {
    if (error instanceof HostOperationError && error.serverMessage)
      throw new OAuthSetupError(error.message);
    throw error;
  }
}

async function cancelSetup(sessionId: string): Promise<void> {
  await requestHost("cancelConnectorSetup", { sessionId }).catch(() => {});
}

/**
 * Start a sign-in, open it, and wait for the server to finish it. Resolves
 * once onConnected has run, or quietly when the token is cancelled.
 */
export async function runOAuthSetup(
  request: OAuthSetupRequest,
  onConnected: (dataSourceId: string) => Promise<void>,
  token: PollToken,
  onSignInUrl: (url: string) => void,
): Promise<void> {
  // Nothing opens until the server has issued an authorization URL: a failed
  // start surfaces its own message instead of stranding a blank window.
  const session = await startSetup(request);
  if (!session.authorizeUrl) {
    await cancelSetup(session.sessionId);
    throw new OAuthSetupError(
      "Couldn't start Google sign-in. Try again in a moment.",
    );
  }
  try {
    // No window handle is not a failure: the sign-in may still have loaded,
    // even in this tab. The session stays open so that sign-in can finish, and
    // the caller offers the URL as a link for when nothing opened at all.
    if (!(await openOAuthAuthorizationUrl(session.authorizeUrl)))
      onSignInUrl(session.authorizeUrl);
  } catch (error) {
    await cancelSetup(session.sessionId);
    throw error;
  }
  await pollOAuthCompletion(session.sessionId, onConnected, token);
}

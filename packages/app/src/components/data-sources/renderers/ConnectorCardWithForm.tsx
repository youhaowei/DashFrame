import { HostOperationError, requestHost } from "@/data/host";
import { useConnectorForm } from "@/hooks/useConnectorForm";
import { openOAuthAuthorizationUrl } from "@/lib/oauth-authorization-target";
import {
  isFileConnector,
  isRemoteApiConnector,
  type AnyConnector,
  type FileSourceConnector,
  type RemoteApiConnector,
} from "@dashframe/engine";
import { useEffect, useRef, useState } from "react";
import { ConnectorCard } from "./ConnectorCard";
import { FormFieldRenderer } from "./FormFieldRenderer";

interface ConnectorCardWithFormProps {
  /** The connector to render */
  connector: AnyConnector;
  /** Called when a file is selected (file connectors only) */
  onFileSelect: (connector: FileSourceConnector, file: File) => Promise<void>;
  /**
   * Called when a remote-api connector's form is submitted with validated
   * credentials. The renderer never calls `connector.connect()` itself — that
   * resolves the credential and lists databases SERVER-SIDE (via the
   * `listNotionDatabases` host operation, keyed off the created DataSource's
   * id). This callback hands the validated form values up so the parent can
   * create the DataSource (storing the credential as a vault SecretRef); the
   * database list is fetched afterward through the server path.
   */
  onConnect: (
    connector: RemoteApiConnector,
    credentials: Record<string, unknown>,
  ) => Promise<void>;
  onOAuthConnect: (
    connector: RemoteApiConnector,
    dataSourceId: string,
  ) => Promise<void>;
  /** Returns false when another connector already owns onboarding. */
  onActivityChange?: (active: boolean) => boolean | void;
  /** Whether this connector's setup form is open. */
  expanded?: boolean;
  /** Toggle handler for the disclosure header. */
  onToggle?: () => void;
  /** Why this server cannot start setup for the connector, if it cannot. */
  unavailableReason?: string;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1_000;

/**
 * Ownership handle for an in-flight OAuth poll.
 *
 * The poll outlives the click that started it — up to POLL_TIMEOUT_MS — so the
 * component needs a way to stop it on unmount. Without one the loop keeps
 * querying the server for fifteen minutes after the card is gone and then calls
 * onOAuthConnect on a tree that no longer exists.
 */
interface PollToken {
  cancelled: boolean;
  activityHeld: boolean;
  activityTransferred: boolean;
  timer?: number;
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
  connector: RemoteApiConnector,
  onOAuthConnect: ConnectorCardWithFormProps["onOAuthConnect"],
  token: PollToken,
): Promise<boolean> {
  if (current.state === "connected") {
    if (!current.dataSourceId) {
      throw new Error("Connected source id is missing");
    }
    token.activityTransferred = true;
    await onOAuthConnect(connector, current.dataSourceId);
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
  connector: RemoteApiConnector,
  sessionId: string,
  onOAuthConnect: ConnectorCardWithFormProps["onOAuthConnect"],
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
    // query is in flight, and onOAuthConnect updates parent state.
    if (token.cancelled) return;
    if (await settleOAuthPoll(current, connector, onOAuthConnect, token))
      return;
  }
  throw new Error("Google authorization timed out");
}

/** An OAuth setup failure whose message is written for the person connecting. */
class OAuthSetupError extends Error {}

/**
 * Only messages meant for people reach the card: the server's own setup
 * rejection or the session's recorded failure. Network and parse failures keep
 * the generic copy.
 */
function oauthSetupErrorMessage(error: unknown): string | undefined {
  return error instanceof OAuthSetupError ? error.message : undefined;
}

async function startSetup(connector: RemoteApiConnector) {
  try {
    return await requestHost("startConnectorSetup", {
      connectorId: connector.id,
      requestedName: connector.name,
    });
  } catch (error) {
    if (error instanceof HostOperationError && error.serverMessage)
      throw new OAuthSetupError(error.message);
    throw error;
  }
}

async function cancelSetup(sessionId: string): Promise<void> {
  await requestHost("cancelConnectorSetup", { sessionId }).catch(() => {});
}

async function runOAuthSetup(
  connector: RemoteApiConnector,
  onOAuthConnect: ConnectorCardWithFormProps["onOAuthConnect"],
  token: PollToken,
  onSignInUrl: (url: string) => void,
): Promise<void> {
  // Nothing opens until the server has issued an authorization URL: a failed
  // start surfaces its own message instead of stranding a blank window.
  const session = await startSetup(connector);
  if (!session.authorizeUrl) {
    await cancelSetup(session.sessionId);
    throw new OAuthSetupError(
      "Couldn't start Google sign-in. Try again in a moment.",
    );
  }
  try {
    // No window handle is not a failure: the sign-in may still have loaded,
    // even in this tab. The session stays open so that sign-in can finish, and
    // the card offers the URL as a link for when nothing opened at all.
    if (!(await openOAuthAuthorizationUrl(session.authorizeUrl)))
      onSignInUrl(session.authorizeUrl);
  } catch (error) {
    await cancelSetup(session.sessionId);
    throw error;
  }
  await pollOAuthCompletion(
    connector,
    session.sessionId,
    onOAuthConnect,
    token,
  );
}

/**
 * Wrapper component that combines ConnectorCard with useConnectorForm hook.
 * This component exists to respect the Rules of Hooks - hooks cannot be called
 * inside loops or conditionals, so each connector needs its own component instance.
 *
 * @example
 * ```tsx
 * {connectors.map((connector) => (
 *   <ConnectorCardWithForm
 *     key={connector.id}
 *     connector={connector}
 *     onFileSelect={handleFileSelect}
 *     onConnect={handleConnect}
 *   />
 * ))}
 * ```
 */
export function ConnectorCardWithForm({
  connector,
  onFileSelect,
  onConnect,
  onOAuthConnect,
  onActivityChange,
  expanded,
  onToggle,
  unavailableReason,
}: ConnectorCardWithFormProps) {
  // Hook called at component top level - safe!
  const { form, formFields, execute, isSubmitting, submitError } =
    useConnectorForm(connector);

  const [signInUrl, setSignInUrl] = useState<string>();
  const pollToken = useRef<PollToken>({
    cancelled: false,
    activityHeld: false,
    activityTransferred: false,
  });
  const onActivityChangeRef = useRef(onActivityChange);
  useEffect(() => {
    onActivityChangeRef.current = onActivityChange;
  }, [onActivityChange]);
  useEffect(() => {
    const token = pollToken.current;
    return () => {
      token.cancelled = true;
      if (token.timer !== undefined) window.clearTimeout(token.timer);
      if (token.activityHeld && !token.activityTransferred) {
        token.activityHeld = false;
        onActivityChangeRef.current?.(false);
      }
    };
  }, []);

  const handleFileSelect = async (file: File) => {
    // Type guard with graceful recovery: if type mismatch occurs (e.g., bad data
    // from storage), log error and return instead of crashing the UI
    if (!isFileConnector(connector)) {
      console.error(
        "[ConnectorCardWithForm] handleFileSelect called on non-file connector:",
        { expected: "file", actual: connector.sourceType, connector },
      );
      return;
    }
    if (onActivityChange?.(true) === false) return;
    try {
      await onFileSelect(connector, file);
    } finally {
      onActivityChange?.(false);
    }
  };

  const handleConnect = async () => {
    // Type guard with graceful recovery: if type mismatch occurs (e.g., bad data
    // from storage), log error and return instead of crashing the UI
    if (!isRemoteApiConnector(connector)) {
      console.error(
        "[ConnectorCardWithForm] handleConnect called on non-remote-api connector:",
        { expected: "remote-api", actual: connector.sourceType, connector },
      );
      return;
    }
    if (unavailableReason) return;
    if (onActivityChange?.(true) === false) return;
    if (connector.authKind === "oauth") {
      const token = pollToken.current;
      token.cancelled = false;
      token.activityHeld = true;
      token.activityTransferred = false;
      setSignInUrl(undefined);
      const result = await execute(
        () => runOAuthSetup(connector, onOAuthConnect, token, setSignInUrl),
        { errorMessage: oauthSetupErrorMessage },
      );
      if (!token.cancelled) setSignInUrl(undefined);
      token.activityHeld = false;
      if (result === null && !token.activityTransferred) {
        onActivityChange?.(false);
      }
      return;
    }

    // The renderer must NOT call connector.connect()/query() — those resolve the
    // credential and hit the remote API SERVER-SIDE (the renderer-registered
    // resolver throws by design). execute() validates the form and returns the
    // credential values; the parent creates the DataSource (storing the key as a
    // vault SecretRef) and lists databases via the listNotionDatabases mutation.
    const result = await execute((data) => onConnect(connector, data));
    if (result === null) {
      onActivityChange?.(false);
    }
  };

  return (
    <ConnectorCard
      connector={connector}
      expanded={expanded}
      onToggle={onToggle}
      onFileSelect={handleFileSelect}
      onConnect={handleConnect}
      isLoading={isSubmitting}
      submitError={submitError}
      unavailableReason={unavailableReason}
      signInUrl={signInUrl}
    >
      {/* Render TanStack Form fields */}
      {formFields.map((fieldDef) => (
        <form.Field key={fieldDef.name} name={fieldDef.name}>
          {(field) => <FormFieldRenderer fieldDef={fieldDef} field={field} />}
        </form.Field>
      ))}
    </ConnectorCard>
  );
}

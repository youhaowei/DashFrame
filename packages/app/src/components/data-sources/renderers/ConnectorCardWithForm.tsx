import { useConnectorForm } from "@/hooks/useConnectorForm";
import { api } from "@/wystack/api";
import { getWyStackClient } from "@/wystack/client";
import {
  isFileConnector,
  isRemoteApiConnector,
  type AnyConnector,
  type FileSourceConnector,
  type RemoteApiConnector,
} from "@dashframe/engine";
import { useEffect, useRef } from "react";
import { ConnectorCard } from "./ConnectorCard";
import { FormFieldRenderer } from "./FormFieldRenderer";

interface ConnectorCardWithFormProps {
  /** The connector to render */
  connector: AnyConnector;
  /** Called when a file is selected (file connectors only) */
  onFileSelect: (connector: FileSourceConnector, file: File) => void;
  /**
   * Called when a remote-api connector's form is submitted with validated
   * credentials. The renderer never calls `connector.connect()` itself — that
   * resolves the credential and lists databases SERVER-SIDE (via the
   * `listNotionDatabases` WyStack mutation, keyed off the created DataSource's
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
  timer?: number;
}

function waitForPoll(token: PollToken): Promise<void> {
  return new Promise((resolve) => {
    token.timer = window.setTimeout(resolve, POLL_INTERVAL_MS);
  });
}

function openAuthorizationWindow(): Window | null {
  // Open synchronously from the click so browser popup policy cannot discard
  // the authorization window while the start call is in flight.
  const authWindow = window.open("about:blank", "_blank");
  if (!authWindow) return null;
  authWindow.opener = null;
  authWindow.document.head.innerHTML =
    '<meta name="referrer" content="no-referrer">';
  authWindow.document.body.textContent = "Preparing Google authorization…";
  return authWindow;
}

/**
 * Interpret one poll result. Returns true when the flow has reached a terminal
 * state and the loop should stop; throws when that state is a failure.
 */
async function settleOAuthPoll(
  current: { state: string; dataSourceId?: string; failureMessage?: string },
  connector: RemoteApiConnector,
  onOAuthConnect: ConnectorCardWithFormProps["onOAuthConnect"],
): Promise<boolean> {
  if (current.state === "connected") {
    if (!current.dataSourceId) {
      throw new Error("Connected source id is missing");
    }
    await onOAuthConnect(connector, current.dataSourceId);
    return true;
  }
  if (current.state === "failed" || current.state === "expired") {
    throw new Error(
      current.failureMessage ?? "Google authorization did not complete",
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
  const client = getWyStackClient();
  for (
    let elapsed = 0;
    elapsed < POLL_TIMEOUT_MS;
    elapsed += POLL_INTERVAL_MS
  ) {
    await waitForPoll(token);
    if (token.cancelled) return;
    const current = await client.query(api.getConnectorSetupSession, {
      sessionId,
    });
    // Checked again after the round trip: the component can unmount while the
    // query is in flight, and onOAuthConnect updates parent state.
    if (token.cancelled) return;
    if (await settleOAuthPoll(current, connector, onOAuthConnect)) return;
  }
  throw new Error("Google authorization timed out");
}

async function runOAuthSetup(
  connector: RemoteApiConnector,
  onOAuthConnect: ConnectorCardWithFormProps["onOAuthConnect"],
  token: PollToken,
): Promise<void> {
  const client = getWyStackClient();
  const authWindow = openAuthorizationWindow();
  let session: { sessionId: string; authorizeUrl?: string };
  try {
    session = await client.mutate(api.startConnectorSetup, {
      connectorId: connector.id,
      requestedName: connector.name,
    });
  } catch (error) {
    authWindow?.close();
    throw error;
  }
  if (!session.authorizeUrl) {
    authWindow?.close();
    throw new Error("Google authorization URL was not issued");
  }
  if (!authWindow) {
    await client.mutate(api.cancelConnectorSetup, {
      sessionId: session.sessionId,
    });
    throw new Error(
      "Google sign-in was blocked. Allow popups for DashFrame and try again.",
    );
  }
  authWindow.location.replace(session.authorizeUrl);
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
}: ConnectorCardWithFormProps) {
  // Hook called at component top level - safe!
  const { form, formFields, execute, isSubmitting, submitError } =
    useConnectorForm(connector);

  const pollToken = useRef<PollToken>({ cancelled: false });
  useEffect(() => {
    const token = pollToken.current;
    return () => {
      token.cancelled = true;
      if (token.timer !== undefined) window.clearTimeout(token.timer);
    };
  }, []);

  const handleFileSelect = (file: File) => {
    // Type guard with graceful recovery: if type mismatch occurs (e.g., bad data
    // from storage), log error and return instead of crashing the UI
    if (!isFileConnector(connector)) {
      console.error(
        "[ConnectorCardWithForm] handleFileSelect called on non-file connector:",
        { expected: "file", actual: connector.sourceType, connector },
      );
      return;
    }
    onFileSelect(connector, file);
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
    if (connector.authKind === "oauth") {
      pollToken.current.cancelled = false;
      await execute(() =>
        runOAuthSetup(connector, onOAuthConnect, pollToken.current),
      );
      return;
    }

    // The renderer must NOT call connector.connect()/query() — those resolve the
    // credential and hit the remote API SERVER-SIDE (the renderer-registered
    // resolver throws by design). execute() validates the form and returns the
    // credential values; the parent creates the DataSource (storing the key as a
    // vault SecretRef) and lists databases via the listNotionDatabases mutation.
    await execute((data) => onConnect(connector, data));
  };

  return (
    <ConnectorCard
      connector={connector}
      onFileSelect={handleFileSelect}
      onConnect={handleConnect}
      isLoading={isSubmitting}
      submitError={submitError}
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

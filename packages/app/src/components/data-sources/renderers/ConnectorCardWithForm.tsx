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

function waitForPoll(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
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

async function pollOAuthCompletion(
  connector: RemoteApiConnector,
  sessionId: string,
  onOAuthConnect: ConnectorCardWithFormProps["onOAuthConnect"],
): Promise<void> {
  const client = getWyStackClient();
  for (
    let elapsed = 0;
    elapsed < POLL_TIMEOUT_MS;
    elapsed += POLL_INTERVAL_MS
  ) {
    await waitForPoll();
    const current = await client.query(api.getConnectorSetupSession, {
      sessionId,
    });
    if (current.state === "connected") {
      const dataSourceId =
        "dataSourceId" in current ? current.dataSourceId : undefined;
      if (!dataSourceId) throw new Error("Connected source id is missing");
      await onOAuthConnect(connector, dataSourceId);
      return;
    }
    if (current.state === "failed" || current.state === "expired") {
      const failureMessage =
        "failureMessage" in current ? current.failureMessage : undefined;
      throw new Error(
        failureMessage ?? "Google authorization did not complete",
      );
    }
  }
  throw new Error("Google authorization timed out");
}

async function runOAuthSetup(
  connector: RemoteApiConnector,
  onOAuthConnect: ConnectorCardWithFormProps["onOAuthConnect"],
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
  await pollOAuthCompletion(connector, session.sessionId, onOAuthConnect);
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
      await execute(() => runOAuthSetup(connector, onOAuthConnect));
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

import { useConnectorForm } from "@/hooks/useConnectorForm";
import {
  cancelPoll,
  newPollToken,
  oauthSetupErrorMessage,
  runOAuthSetup,
  type PollToken,
} from "@/lib/connector-oauth-setup";
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
  const pollToken = useRef<PollToken>(newPollToken());
  const onActivityChangeRef = useRef(onActivityChange);
  useEffect(() => {
    onActivityChangeRef.current = onActivityChange;
  }, [onActivityChange]);
  useEffect(() => {
    const token = pollToken.current;
    return () => {
      cancelPoll(token);
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
        () =>
          runOAuthSetup(
            { connectorId: connector.id, requestedName: connector.name },
            (dataSourceId) => onOAuthConnect(connector, dataSourceId),
            token,
            setSignInUrl,
          ),
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

import { useConnectorForm } from "@/hooks/useConnectorForm";
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
  ) => void;
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
    // The renderer must NOT call connector.connect()/query() — those resolve the
    // credential and hit the remote API SERVER-SIDE (the renderer-registered
    // resolver throws by design). execute() validates the form and returns the
    // credential values; the parent creates the DataSource (storing the key as a
    // vault SecretRef) and lists databases via the listNotionDatabases mutation.
    const credentials = await execute(async (data) => data);
    if (credentials) {
      onConnect(connector, credentials);
    }
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

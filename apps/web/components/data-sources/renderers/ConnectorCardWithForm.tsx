"use client";

import {
  isFileConnector,
  isRemoteApiConnector,
  type AnyConnector,
  type FileSourceConnector,
  type RemoteApiConnector,
  type RemoteDatabase,
} from "@dashframe/engine";
import { useConnectorForm } from "@/hooks/useConnectorForm";
import { ConnectorCard } from "./ConnectorCard";
import { FormFieldRenderer } from "./FormFieldRenderer";

interface ConnectorCardWithFormProps {
  /** The connector to render */
  connector: AnyConnector;
  /** Called when a file is selected (file connectors only) */
  onFileSelect: (connector: FileSourceConnector, file: File) => void;
  /** Called when connection succeeds (remote-api connectors only) */
  onConnect: (
    connector: RemoteApiConnector,
    databases: RemoteDatabase[],
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
    const databases = await execute((data) => connector.connect(data));
    if (databases) {
      onConnect(connector, databases);
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

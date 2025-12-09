"use client";

import type {
  AnyConnector,
  FileSourceConnector,
  RemoteApiConnector,
  RemoteDatabase,
} from "@dashframe/dataframe";
import { useConnectorForm } from "@/hooks/useConnectorForm";
import { ConnectorCard } from "./ConnectorCard";
import { FormFieldRenderer } from "./FormFieldRenderer";

interface ConnectorCardWithFormProps {
  /** The connector to render */
  connector: AnyConnector;
  /** Called when a file is selected (file connectors only) */
  onFileSelect: (connector: FileSourceConnector, file: File) => void;
  /** Called when connection succeeds (remote-api connectors only) */
  onConnect: (connector: RemoteApiConnector, databases: RemoteDatabase[]) => void;
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
    onFileSelect(connector as FileSourceConnector, file);
  };

  const handleConnect = async () => {
    const databases = await execute((data) =>
      (connector as RemoteApiConnector).connect(data),
    );
    if (databases) {
      onConnect(connector as RemoteApiConnector, databases);
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

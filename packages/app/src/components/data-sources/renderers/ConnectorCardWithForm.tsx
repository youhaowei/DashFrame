import { useConnectorForm } from "@/hooks/useConnectorForm";
import {
  isFileConnector,
  isRemoteConnectorKind,
  type AnyConnector,
  type FileSourceConnector,
  type RemoteApiConnector,
  type RemoteDatabase,
  type SecretResolver,
} from "@dashframe/engine";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
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
 * For remote connectors: the form captures credentials (apiKey, etc.) which are
 * stored in an ephemeral in-memory vault for the discovery phase. The vault ref
 * is used to mint a SecretResolver and construct an auth-bound connector. The
 * full control-plane credential-persistence flow (vault store + ref migration)
 * is handled by the control-plane migration ticket.
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
    // Type guard with graceful recovery
    if (!isRemoteConnectorKind(connector)) {
      console.error(
        "[ConnectorCardWithForm] handleConnect called on non-remote-api connector:",
        { expected: "remote-api", actual: connector.sourceType, connector },
      );
      return;
    }

    // Capture credentials from form and create an ephemeral in-memory vault for
    // the discovery phase. The full credential persistence (storing to keychain
    // and writing the ref to DataSource config) is handled by the control-plane
    // migration flow (persistent vault + ref wiring).
    //
    // This is NOT a persistent vault: the credential lives only for the duration
    // of connector.connect(). The vault and ref never escape this callback —
    // the auth-blind contract is upheld (the `boundConnector` has no vault in
    // scope; it only has a pre-bound SecretResolver).
    const databases = await execute(async (formData) => {
      // Build an ephemeral in-memory vault backed by TestBackend.
      // This is appropriate for the discovery phase where we have a raw
      // apiKey from the form and no persistent vault yet.
      const backend = new TestBackend();
      const registry = new SecretRegistry();
      registry.register("ephemeral", backend, { fallback: true });
      const vault = new SecretVault(registry, new InMemoryMappingStore());

      const apiKey = formData.apiKey as string;
      const ref = await vault.store(apiKey, { class: "connector-key" });

      // Mint the one-ref-bound resolver — capability attenuation by construction.
      // The `boundConnector` can ONLY resolve this ref; it has no vault reference.
      // Cast as SecretResolver (not inline generic arrow) to avoid TSX JSX ambiguity.
      const auth: SecretResolver = (use) => vault.withSecret(ref, use);

      const boundConnector = connector.createConnector(auth);
      return boundConnector.connect();
    });

    if (databases) {
      // Pass a connector instance to the onConnect callback. Since the ephemeral
      // vault is scoped to handleConnect, we create a fresh instance here.
      // The onConnect caller receives metadata from the kind descriptor.
      const placeholderConnector = connector.createConnector(
        // Stub resolver — the connector passed to onConnect is for metadata
        // access only (id, name). The control-plane flow handles obtaining
        // a persistent resolver for subsequent data operations.
        () =>
          Promise.reject(new Error("Persistent resolver not yet available")),
      );
      onConnect(placeholderConnector, databases);
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

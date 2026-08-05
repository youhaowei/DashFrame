import { useConnectorCatalog } from "@/data/connector-catalog";
import {
  getConnectorById,
  useRegistryVersion,
} from "@/lib/connectors/registry";
import type {
  AnyConnector,
  FileSourceConnector,
  RemoteApiConnector,
} from "@dashframe/engine";
import {
  Alert,
  AlertDescription,
  ErrorState,
  Spinner,
} from "@wystack/ui-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { ConnectorCardWithForm } from "./renderers";

export interface AddConnectionPanelProps {
  /** Global error message to display */
  error?: string | null;
  /** Called when a file is selected from a file connector */
  onFileSelect: (connector: FileSourceConnector, file: File) => void;
  /**
   * Called when a remote connector's form is submitted with validated
   * credentials. The credential is resolved server-side — the renderer never
   * calls connect()/query() on the connector.
   */
  onConnect: (
    connector: RemoteApiConnector,
    credentials: Record<string, unknown>,
  ) => Promise<void>;
}

/**
 * Panel for adding new data connections.
 * Renders connector cards dynamically from the server catalog (via registry).
 *
 * @example
 * ```tsx
 * <AddConnectionPanel
 *   onFileSelect={(connector, file) => handleFileUpload(connector, file)}
 *   onConnect={(connector, credentials) => handleConnect(credentials)}
 * />
 * ```
 */
export function AddConnectionPanel({
  error,
  onFileSelect,
  onConnect,
}: AddConnectionPanelProps) {
  const { data: catalog, isLoading, isError, refetch } = useConnectorCatalog();

  // Subscribed so `connectors` below recomputes once the client registry
  // hydrates (ConnectorSetup's effect runs after this component's first
  // render, and getConnectorById reads a module-scope map that TanStack
  // Query's stable `catalog` identity alone will not trigger a re-read for).
  const registryVersion = useRegistryVersion();

  const connectors = useMemo(() => {
    if (!catalog) return [];
    return catalog
      .map((entry) => getConnectorById(entry.id))
      .filter((c): c is AnyConnector => c !== undefined);
    // registryVersion isn't read in the body above — it's a trigger-only
    // dependency so this recomputes once the registry hydrates after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, registryVersion]);

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-fg-subtle">
        <Spinner size="sm" />
        Loading connectors…
      </div>
    );
  } else if (isError) {
    body = (
      <ErrorState
        title="Failed to load connectors"
        description="DashFrame could not reach the connector catalog. Check that the server is running, then retry."
        retryAction={{ label: "Retry", onClick: () => void refetch() }}
      />
    );
  } else if (connectors.length === 0) {
    body = (
      <p className="py-8 text-center text-sm text-neutral-fg-subtle">
        No connectors are available.
      </p>
    );
  } else {
    body = (
      <div className="space-y-4">
        {connectors.map((connector) => (
          <ConnectorCardWithForm
            key={connector.id}
            connector={connector}
            onFileSelect={onFileSelect}
            onConnect={onConnect}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert color="danger">
          <AlertDescription>
            <pre className="overflow-auto text-xs">{error}</pre>
          </AlertDescription>
        </Alert>
      )}

      {body}
    </div>
  );
}

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
  Button,
  ErrorState,
  Spinner,
} from "@wystack/ui-react";
import { ArrowLeftIcon } from "@wystack/ui-react/icons";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { ConnectorCardWithForm } from "./renderers";

export interface AddConnectionPanelProps {
  /** Global error message to display */
  error?: string | null;
  /** Called when a file is selected from a file connector */
  onFileSelect: (connector: FileSourceConnector, file: File) => Promise<void>;
  /**
   * Called when a remote connector's form is submitted with validated
   * credentials. The credential is resolved server-side — the renderer never
   * calls connect()/query() on the connector.
   */
  onConnect: (
    connector: RemoteApiConnector,
    credentials: Record<string, unknown>,
  ) => Promise<void>;
  /** Called after an OAuth connector reaches the connected terminal state. */
  onOAuthConnect: (
    connector: RemoteApiConnector,
    dataSourceId: string,
  ) => Promise<void>;
  onActivityChange?: (active: boolean) => void;
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
  onOAuthConnect,
  onActivityChange,
}: AddConnectionPanelProps) {
  const [activeConnectorId, setActiveConnectorId] = useState<string | null>(
    null,
  );
  // Which connector's setup form is open. Deliberately separate from
  // `activeConnectorId`: that one is the in-flight ownership lock, and folding
  // the two together would collapse a card mid-upload.
  const [expandedConnectorId, setExpandedConnectorId] = useState<string | null>(
    null,
  );
  const activeConnectorIdRef = useRef<string | null>(null);
  const { data: catalog, isLoading, isError, refetch } = useConnectorCatalog();

  const handleActivityChange = useCallback(
    (connectorId: string, active: boolean): boolean => {
      if (active) {
        if (activeConnectorIdRef.current !== null) return false;
        activeConnectorIdRef.current = connectorId;
        setActiveConnectorId(connectorId);
        onActivityChange?.(true);
        return true;
      }

      if (activeConnectorIdRef.current !== connectorId) return false;
      activeConnectorIdRef.current = null;
      setActiveConnectorId(null);
      onActivityChange?.(active);
      return true;
    },
    [onActivityChange],
  );

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
    // oxlint-disable-next-line react-hooks-js/exhaustive-deps
  }, [catalog, registryVersion]);

  // The connector the reader picked, if it is still in the catalog. A stale id
  // (the registry rehydrated without it) falls back to the list rather than
  // rendering an empty detail view.
  const selectedConnector = expandedConnectorId
    ? connectors.find((connector) => connector.id === expandedConnectorId)
    : undefined;

  const renderCard = (connector: AnyConnector, onToggle?: () => void) => (
    <ConnectorCardWithForm
      key={connector.id}
      connector={connector}
      expanded={selectedConnector?.id === connector.id}
      onToggle={onToggle}
      onFileSelect={onFileSelect}
      onConnect={onConnect}
      onOAuthConnect={async (...args) => {
        try {
          await onOAuthConnect(...args);
        } catch (cause) {
          handleActivityChange(connector.id, false);
          throw cause;
        }
      }}
      onActivityChange={(active) => handleActivityChange(connector.id, active)}
    />
  );

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
  } else if (selectedConnector) {
    // Picking a source is a decision, and once it is made the alternatives stop
    // being useful — they are a list of things the reader has just declined,
    // sitting between them and the credential fields they now have to fill in.
    // The chosen connector stays on screen as a static row so it still says
    // what is being set up; going back is the one competing action left.
    body = (
      <div className="space-y-1">
        <Button
          label="Choose another source"
          variant="ghost"
          size="sm"
          icon={ArrowLeftIcon}
          // A connector that owns onboarding cannot be left: its progress label
          // and submit error render inside the card, and returning to the list
          // mid-connect would hide both.
          disabled={activeConnectorId === selectedConnector.id}
          onClick={() => setExpandedConnectorId(null)}
        />
        {renderCard(selectedConnector)}
      </div>
    );
  } else {
    body = (
      <div className="space-y-1">
        {connectors.map((connector) =>
          renderCard(connector, () => setExpandedConnectorId(connector.id)),
        )}
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

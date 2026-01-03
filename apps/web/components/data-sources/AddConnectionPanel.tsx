"use client";

import { getConnectors } from "@/lib/connectors/registry";
import type {
  FileSourceConnector,
  RemoteApiConnector,
  RemoteDatabase,
} from "@dashframe/engine";
import { Alert, AlertDescription } from "@dashframe/ui";
import { useMemo } from "react";
import { ConnectorCardWithForm } from "./renderers";

export interface AddConnectionPanelProps {
  /** Global error message to display */
  error?: string | null;
  /** Called when a file is selected from a file connector */
  onFileSelect: (connector: FileSourceConnector, file: File) => void;
  /** Called when a remote connector successfully connects */
  onConnect: (
    connector: RemoteApiConnector,
    databases: RemoteDatabase[],
  ) => void;
  /** Whether to show Notion connector (feature flag) */
  showNotion?: boolean;
}

/**
 * Panel for adding new data connections.
 * Renders connector cards dynamically from the registry.
 *
 * @example
 * ```tsx
 * <AddConnectionPanel
 *   onFileSelect={(connector, file) => handleFileUpload(connector, file)}
 *   onConnect={(connector, databases) => handleConnect(databases)}
 *   showNotion={true}
 * />
 * ```
 */
export function AddConnectionPanel({
  error,
  onFileSelect,
  onConnect,
  showNotion = false,
}: AddConnectionPanelProps) {
  // Get connectors from registry with feature flags
  const connectors = useMemo(() => getConnectors({ showNotion }), [showNotion]);

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <pre className="overflow-auto text-xs">{error}</pre>
          </AlertDescription>
        </Alert>
      )}

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
    </div>
  );
}

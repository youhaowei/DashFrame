/**
 * Connector Registry - Central registration for all data source connectors.
 *
 * The web app decides which connectors are available. This allows:
 * - Enabling/disabling connectors via feature flags
 * - Adding new connectors without modifying components
 * - Type-safe connector access
 *
 * @example
 * ```tsx
 * import { getConnectors } from '@/lib/connectors/registry';
 *
 * // Get all file connectors
 * const fileConnectors = getConnectors({ sourceType: 'file' });
 *
 * // Get connector by ID
 * const csvConnector = getConnectorById('csv');
 * ```
 */

import { csvConnector } from "@dashframe/connector-csv";
import { notionConnector } from "@dashframe/connector-notion";
import type {
  AnyConnector,
  FileSourceConnector,
  RemoteApiConnector,
} from "@dashframe/engine";

/**
 * All registered connectors (singletons - stateless).
 * Order determines display order in the UI.
 */
const allConnectors: AnyConnector[] = [csvConnector, notionConnector];

/**
 * Options for filtering connectors
 */
export interface GetConnectorsOptions {
  /** Show Notion connector (default: false for feature flag control) */
  showNotion?: boolean;
  /** Filter by source type */
  sourceType?: "file" | "remote-api";
}

/**
 * Get available connectors, optionally filtered.
 *
 * @param options - Filter options
 * @returns Array of connectors matching the filter criteria
 */
export function getConnectors(options?: GetConnectorsOptions): AnyConnector[] {
  return allConnectors.filter((connector) => {
    // Feature flag: Notion
    if (connector.id === "notion" && !(options?.showNotion ?? false)) {
      return false;
    }

    // Filter by source type if specified
    if (options?.sourceType && connector.sourceType !== options.sourceType) {
      return false;
    }

    return true;
  });
}

/**
 * Get a specific connector by ID.
 *
 * @param id - Connector ID (e.g., 'csv', 'notion')
 * @returns The connector, or undefined if not found
 */
export function getConnectorById(id: string): AnyConnector | undefined {
  return allConnectors.find((connector) => connector.id === id);
}

/**
 * Get all file source connectors.
 */
export function getFileConnectors(
  options?: Omit<GetConnectorsOptions, "sourceType">,
): FileSourceConnector[] {
  return getConnectors({
    ...options,
    sourceType: "file",
  }) as FileSourceConnector[];
}

/**
 * Get all remote API connectors.
 */
export function getRemoteConnectors(
  options?: Omit<GetConnectorsOptions, "sourceType">,
): RemoteApiConnector[] {
  return getConnectors({
    ...options,
    sourceType: "remote-api",
  }) as RemoteApiConnector[];
}

/**
 * Get all connector IDs.
 */
export function getConnectorIds(): string[] {
  return allConnectors.map((c) => c.id);
}

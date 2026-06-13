/**
 * Connector Registry
 *
 * Pluggable connector architecture: new connector kinds register themselves
 * at boot time instead of being hard-coded in a static array. Mirrors the
 * chart renderer registry in @dashframe/visualization.
 *
 * @example
 * ```ts
 * // Register at boot
 * registerConnector(localFileConnector);
 * registerConnector(notionConnector);
 *
 * // Resolve in a component
 * const connector = getConnectorById(source.type);
 * ```
 */

import type {
  AnyConnector,
  FileSourceConnector,
  RemoteApiConnector,
} from "@dashframe/engine";
import { isFileConnector, isRemoteApiConnector } from "@dashframe/engine";
import { useSyncExternalStore } from "react";

// ============================================================================
// Registry Implementation
// ============================================================================

/**
 * Internal registry map.
 * Maps connector id to connector instance.
 */
const connectorMap = new Map<string, AnyConnector>();

/**
 * Registry version counter.
 * Increments each time a genuinely new connector id is registered.
 */
let registryVersion = 0;

/**
 * Listeners for registry changes.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(): void {
  listeners.forEach((l) => l());
}

/**
 * Get the current registry version.
 * Used by components to detect when the connector list changes.
 */
export function getRegistryVersion(): number {
  return registryVersion;
}

/**
 * React hook — subscribe to registry changes.
 * Returns the current version; triggers re-render on first registration of any
 * connector kind (idempotent on re-registration of the same id).
 */
export function useRegistryVersion(): number {
  return useSyncExternalStore(
    subscribe,
    getRegistryVersion,
    getRegistryVersion,
  );
}

/**
 * Register a connector kind.
 *
 * Overwrites any existing registration for the same id (idempotent — HMR-safe).
 * Only increments the registry version when a genuinely new id is registered,
 * not when re-registering the same id with the same singleton.
 *
 * @param connector - The connector instance to register
 */
export function registerConnector(connector: AnyConnector): void {
  const isNew = !connectorMap.has(connector.id);
  connectorMap.set(connector.id, connector);

  if (isNew) {
    registryVersion++;
    notifyListeners();
  }
}

/**
 * Clear all registered connectors.
 * Notifies subscribers so any component holding `useRegistryVersion()` will
 * re-render and see an empty registry. Does not increment the registry version
 * (version monotonically tracks new-id additions, not removals).
 */
export function clearConnectorRegistry(): void {
  connectorMap.clear();
  notifyListeners();
}

// ============================================================================
// Query API
// ============================================================================

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
 * Order reflects registration order.
 */
export function getConnectors(options?: GetConnectorsOptions): AnyConnector[] {
  return Array.from(connectorMap.values()).filter((connector) => {
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
 * Get a specific connector by its id.
 *
 * @param id - The connector id (e.g. "local", "notion")
 * @returns The registered connector, or undefined if not found
 */
export function getConnectorById(id: string): AnyConnector | undefined {
  return connectorMap.get(id);
}

/**
 * Check whether a connector id has been registered.
 */
export function hasConnector(id: string): boolean {
  return connectorMap.has(id);
}

/**
 * Get all registered connector ids, in insertion order.
 */
export function getConnectorIds(): string[] {
  return Array.from(connectorMap.keys());
}

/**
 * Get all registered file source connectors.
 */
export function getFileConnectors(
  options?: Omit<GetConnectorsOptions, "sourceType">,
): FileSourceConnector[] {
  return getConnectors({ ...options, sourceType: "file" }).filter(
    isFileConnector,
  );
}

/**
 * Get all registered remote API connectors.
 */
export function getRemoteConnectors(
  options?: Omit<GetConnectorsOptions, "sourceType">,
): RemoteApiConnector[] {
  return getConnectors({ ...options, sourceType: "remote-api" }).filter(
    isRemoteApiConnector,
  );
}

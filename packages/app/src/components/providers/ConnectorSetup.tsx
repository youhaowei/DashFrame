/**
 * ConnectorSetup — boot-time connector registration.
 *
 * Registers each known connector kind into the connector registry at module
 * load time so the registry is fully populated before any component renders.
 * Connectors are stateless singletons, so registration is idempotent and safe
 * to run eagerly (no browser APIs, no side effects).
 *
 * This differs from RendererRegistration (which uses useEffect) because chart
 * renderers need a live DuckDB/vgplot instance before they can be used, so
 * their registration is deferred to when the engine is ready. Connectors carry
 * only static metadata (id, name, icon, form fields) — they're available
 * immediately.
 *
 * Mount ConnectorSetup once near the root (e.g. inside RouteRoot) so this
 * module is loaded at app startup. The component itself renders nothing.
 */

import { registerConnector } from "@/lib/connectors/registry";
import { localFileConnector } from "@dashframe/connector-local";
import { notionConnectorKind } from "@dashframe/connector-notion";

// Register connectors at module scope — synchronous, before any render.
// getConnectorById() calls from any component on first render will resolve.
//
// Remote connectors: register the KIND descriptor (metadata + factory), not
// an auth-bound instance. Use kind.createConnector(auth) at connect/query time.
registerConnector(localFileConnector);
registerConnector(notionConnectorKind);

/**
 * Renders nothing. Import side-effect (module-scope registration above) is
 * what does the work. This component exists only as an explicit mount-point
 * anchor so RouteRoot can document "connectors are set up here".
 */
export function ConnectorSetup() {
  return null;
}

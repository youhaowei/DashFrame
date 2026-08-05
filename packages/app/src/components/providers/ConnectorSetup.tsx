import { useConnectorCatalog } from "@/data/connector-catalog";
import { hydrateConnectorRegistry } from "@/lib/connectors/registry";
import { makeGa4Connector } from "@dashframe/connector-ga4";
import { localFileConnector } from "@dashframe/connector-local";
import { makeNotionConnector } from "@dashframe/connector-notion";
import { makePostgresConnector } from "@dashframe/connector-postgres";
import type { AnyConnector } from "@dashframe/engine";
import { useEffect } from "react";

// Static-metadata-only instances — connect()/query() are never called from the
// renderer (they go through the WyStack server mutations). Unchanged from the
// previous version of this file, just no longer registered unconditionally.
const notionConnectorForRegistry = makeNotionConnector(() => {
  throw new Error(
    "[connector-registry] connect()/query() must not be called from the renderer — " +
      "use the WyStack server mutations instead.",
  );
});

const postgresConnectorForRegistry = makePostgresConnector(() => {
  throw new Error(
    "[connector-registry] connect()/query() must not be called from the renderer — " +
      "use the WyStack server mutations instead.",
  );
}, {});

const ga4ConnectorForRegistry = makeGa4Connector(() => {
  throw new Error(
    "[connector-registry] connect()/query() must not be called from the renderer — " +
      "use the WyStack server mutations instead.",
  );
});

const CONNECTOR_FACTORIES: Record<string, () => AnyConnector> = {
  local: () => localFileConnector,
  notion: () => notionConnectorForRegistry,
  postgres: () => postgresConnectorForRegistry,
  googleAnalytics: () => ga4ConnectorForRegistry,
};

/**
 * Renders nothing. Fetches the server connector catalog and hydrates the
 * client registry from it (see hydrateConnectorRegistry in registry.ts) —
 * the registry is a rendering-detail cache of live connector instances,
 * populated FROM the server read, not by independent client-side
 * registration. Which connector ids exist is a server-side property; this
 * component only supplies the client-only, non-serializable behavior
 * (parse/validate/the throwing connect/query stubs) for ids the server says
 * exist.
 *
 * Effect-based, like RendererRegistration in VisualizationSetup.tsx, because
 * the catalog now requires a server round-trip — this can no longer be
 * synchronous module-scope registration. Consumers that read the registry
 * before the catalog resolves see it partially/un-populated, exactly as
 * VisualizationSetup's children tolerate renderers not yet being ready.
 */
export function ConnectorSetup() {
  const { data: catalog } = useConnectorCatalog();

  useEffect(() => {
    if (catalog) {
      hydrateConnectorRegistry(catalog, CONNECTOR_FACTORIES);
    }
  }, [catalog]);

  return null;
}

import { makeNotionConnector } from "@dashframe/connector-notion";
import { makePostgresConnector } from "@dashframe/connector-postgres";
import type { AnyConnector } from "@dashframe/engine";
import { isFileConnector } from "@dashframe/engine";
import type {
  ConnectorCatalogEntry,
  ConnectorFormField,
} from "@dashframe/types";

import { wy } from "../wystack";

const throwingResolver = () => {
  throw new Error(
    "[connector-catalog] connect()/query() must not be called while building catalog metadata.",
  );
};

function toCatalogEntry(connector: AnyConnector): ConnectorCatalogEntry {
  const formFields = connector.getFormFields() as ConnectorFormField[];
  const authKind = formFields.some((field) => field.type === "password")
    ? "credential"
    : "none";

  const entry: ConnectorCatalogEntry = {
    id: connector.id,
    name: connector.name,
    description: connector.description,
    sourceType: connector.sourceType,
    icon: connector.icon,
    authKind,
    formFields,
  };

  if (isFileConnector(connector)) {
    entry.accept = connector.accept;
    entry.maxSizeMB = connector.maxSizeMB;
    entry.helperText = connector.helperText;
  }

  return entry;
}

/**
 * The "local" file connector's class lives in @dashframe/connector-local, which
 * value-imports from @dashframe/engine-browser (IndexedDB/DuckDB-WASM). That
 * package is deliberately NOT a server runtime dependency — see the guard at
 * apps/desktop/src/main-bundle.test.ts ("browser-only code reaching main
 * (#228)"). Its catalog metadata is plain static data, so it's reproduced
 * literally here instead of importing the class. The literal values below are
 * copied verbatim from packages/connector-local/src/connector.ts (id, name,
 * description, icon, accept, maxSizeMB, helperText). A drift-guard test
 * (connector-catalog.test.ts) imports the real class as a
 * devDependency ONLY and asserts these literals still match it.
 */
export const LOCAL_CATALOG_ENTRY: ConnectorCatalogEntry = {
  id: "local",
  name: "Local Files",
  description: "Upload a CSV or JSON file from your computer.",
  sourceType: "file",
  icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15l3-3 3 3"/></svg>`,
  authKind: "none",
  formFields: [],
  accept: ".csv,.json,text/csv,application/json",
  maxSizeMB: 100,
  helperText: "Supports CSV and JSON files up to 100MB (stored locally)",
};

// Constructed with a throwing resolver purely to read static metadata
// (id/name/description/icon/getFormFields()) — the exact same pattern already
// used client-side in packages/app/src/components/providers/ConnectorSetup.tsx.
// connect()/query() are never called on these instances.
const notionConnectorForCatalog = makeNotionConnector(throwingResolver);
const postgresConnectorForCatalog = makePostgresConnector(throwingResolver, {});

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  LOCAL_CATALOG_ENTRY,
  toCatalogEntry(notionConnectorForCatalog),
  toCatalogEntry(postgresConnectorForCatalog),
];

const getConnectorCatalog = wy.procedure
  .input({})
  .query(async (): Promise<ConnectorCatalogEntry[]> => CONNECTOR_CATALOG);

export const connectorCatalogFunctions = {
  getConnectorCatalog,
};

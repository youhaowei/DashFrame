import { makeGa4Connector } from "@dashframe/connector-ga4";
import { makeNotionConnector } from "@dashframe/connector-notion";
import { makePostgresConnector } from "@dashframe/connector-postgres";
import type { AnyConnector } from "@dashframe/engine";
import { isFileConnector } from "@dashframe/engine";
import type {
  ConnectorCatalogEntry,
  ConnectorFormField,
} from "@dashframe/types";
import {
  LOCAL_FILE_HELPER_TEXT,
  LOCAL_FILE_SOURCE_LIMIT_MB,
} from "@dashframe/types";

import { wy } from "../wystack";

const throwingResolver = () => {
  throw new Error(
    "[connector-catalog] connect()/query() must not be called while building catalog metadata.",
  );
};

function toCatalogEntry(connector: AnyConnector): ConnectorCatalogEntry {
  const formFields = connector.getFormFields() as ConnectorFormField[];
  let authKind: ConnectorCatalogEntry["authKind"] = "none";
  if (connector.authKind === "oauth") {
    authKind = "oauth";
  } else if (formFields.some((field) => field.type === "password")) {
    authKind = "credential";
  }

  const entry: ConnectorCatalogEntry = {
    id: connector.id,
    name: connector.name,
    description: connector.description,
    sourceType: connector.sourceType,
    icon: connector.icon,
    authKind,
    formFields: Object.freeze(formFields) as ConnectorFormField[],
  };

  if (isFileConnector(connector)) {
    entry.accept = connector.accept;
    entry.maxSizeMB = connector.maxSizeMB;
    entry.helperText = connector.helperText;
  }

  return Object.freeze(entry);
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
export const LOCAL_CATALOG_ENTRY: ConnectorCatalogEntry = Object.freeze({
  id: "local",
  name: "Local Files",
  description: "Upload a CSV or JSON file from your computer.",
  sourceType: "file",
  icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15l3-3 3 3"/></svg>`,
  authKind: "none",
  formFields: Object.freeze([] as ConnectorFormField[]) as ConnectorFormField[],
  accept: ".csv,.json,text/csv,application/json",
  maxSizeMB: LOCAL_FILE_SOURCE_LIMIT_MB,
  helperText: LOCAL_FILE_HELPER_TEXT,
});

/**
 * Lazily builds and memoizes the catalog on first read rather than at module
 * load. The remote connector instances below exist purely to read
 * static metadata (id/name/description/icon/getFormFields()) — the exact same
 * pattern already used client-side in
 * packages/app/src/components/providers/ConnectorSetup.tsx — but constructing
 * them still runs connector-package module init code. Deferring that to first
 * call keeps a `functions.ts` import (e.g. from an unrelated unit test) from
 * paying that cost, or from breaking if a caller mocks one of the connector
 * packages without a full metadata surface.
 *
 * The returned array and every entry in it are frozen so callers can't mutate
 * the shared cached instance.
 */
let cachedCatalog: ConnectorCatalogEntry[] | null = null;

function buildConnectorCatalog(): ConnectorCatalogEntry[] {
  // Constructed with a throwing resolver purely to read static metadata.
  // connect()/query() are never called on these instances.
  const notionConnectorForCatalog = makeNotionConnector(throwingResolver);
  const postgresConnectorForCatalog = makePostgresConnector(
    throwingResolver,
    {},
  );
  const ga4ConnectorForCatalog = makeGa4Connector(throwingResolver);

  return Object.freeze([
    LOCAL_CATALOG_ENTRY,
    toCatalogEntry(notionConnectorForCatalog),
    toCatalogEntry(postgresConnectorForCatalog),
    toCatalogEntry(ga4ConnectorForCatalog),
  ]) as ConnectorCatalogEntry[];
}

export function getConnectorCatalogEntries(): ConnectorCatalogEntry[] {
  cachedCatalog ??= buildConnectorCatalog();
  return cachedCatalog;
}

const getConnectorCatalog = wy.procedure
  .input({})
  .query(async (): Promise<ConnectorCatalogEntry[]> =>
    getConnectorCatalogEntries(),
  );

export const connectorCatalogFunctions = {
  getConnectorCatalog,
};

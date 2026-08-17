import { localFileConnector } from "@dashframe/connector-local";
import { describe, expect, it } from "vite-plus/test";

import {
  getConnectorCatalogEntries,
  LOCAL_CATALOG_ENTRY,
} from "./connector-catalog";

describe("LOCAL_CATALOG_ENTRY drift guard", () => {
  it("matches the real localFileConnector static metadata", () => {
    expect(LOCAL_CATALOG_ENTRY.id).toBe(localFileConnector.id);
    expect(LOCAL_CATALOG_ENTRY.name).toBe(localFileConnector.name);
    expect(LOCAL_CATALOG_ENTRY.description).toBe(
      localFileConnector.description,
    );
    expect(LOCAL_CATALOG_ENTRY.icon).toBe(localFileConnector.icon);
    expect(LOCAL_CATALOG_ENTRY.accept).toBe(localFileConnector.accept);
    expect(LOCAL_CATALOG_ENTRY.maxSizeMB).toBe(localFileConnector.maxSizeMB);
    expect(LOCAL_CATALOG_ENTRY.helperText).toBe(localFileConnector.helperText);
    expect(LOCAL_CATALOG_ENTRY.sourceType).toBe(localFileConnector.sourceType);
    expect(LOCAL_CATALOG_ENTRY.formFields).toEqual(
      localFileConnector.getFormFields(),
    );
  });
});

describe("connector catalog OAuth metadata", () => {
  it("advertises Google Analytics as an OAuth connector with no form fields", () => {
    const entry = getConnectorCatalogEntries().find(
      ({ id }) => id === "googleAnalytics",
    );

    expect(entry).toMatchObject({
      id: "googleAnalytics",
      sourceType: "remote-api",
      authKind: "oauth",
      formFields: [],
    });
  });
});

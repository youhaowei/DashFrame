import { localFileConnector } from "@dashframe/connector-local";
import type { ConnectorCatalogEntry } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";

import {
  getConnectorCatalog,
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

describe("connector catalog OAuth availability", () => {
  const googleAnalytics = (entries: ConnectorCatalogEntry[]) =>
    entries.find(({ id }) => id === "googleAnalytics");

  it("marks Google Analytics unavailable when no OAuth client is configured", async () => {
    const entries = await getConnectorCatalog({
      getServerEndpoint: () => "http://127.0.0.1:4000",
    });

    expect(googleAnalytics(entries)?.unavailableReason).toMatch(
      /Google sign-in isn't set up on this server/,
    );
    for (const entry of entries.filter(({ authKind }) => authKind !== "oauth"))
      expect(entry).not.toHaveProperty("unavailableReason");
  });

  it("leaves Google Analytics available when an OAuth client is configured", async () => {
    const entries = await getConnectorCatalog({
      googleOAuth: { clientId: "client", clientSecret: "secret" },
      getServerEndpoint: () => "http://127.0.0.1:4000",
    });

    expect(googleAnalytics(entries)).not.toHaveProperty("unavailableReason");
  });

  it("marks Google Analytics unavailable on a public host with no redirect base", async () => {
    const googleOAuth = { clientId: "client", clientSecret: "secret" };
    const getServerEndpoint = () => "https://dashframe.example";

    expect(
      googleAnalytics(
        await getConnectorCatalog({ googleOAuth, getServerEndpoint }),
      )?.unavailableReason,
    ).toMatch(/OAuth redirect base/);
    expect(
      googleAnalytics(
        await getConnectorCatalog({
          googleOAuth: {
            ...googleOAuth,
            redirectBase: "https://dashframe.example",
          },
          getServerEndpoint,
        }),
      ),
    ).not.toHaveProperty("unavailableReason");
  });
});

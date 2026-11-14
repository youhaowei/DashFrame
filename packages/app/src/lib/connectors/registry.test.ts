/**
 * Unit tests for the connector registry module.
 *
 * Contracts verified:
 * - getConnectorById() returns the most recently registered connector for an id
 * - getConnectors() enumerates registered kinds, optionally by source type
 * - clearConnectorRegistry() resets the map and bumps the version (so
 *   subscribers re-render)
 * - getRegistryVersion() increments on a genuinely new id or a clear, not on
 *   same-id re-registration
 * - hydrateConnectorRegistry() registers matching factories and skips unknowns
 */

import type { AnyConnector } from "@dashframe/engine";
import type { ConnectorCatalogEntry } from "@dashframe/types";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  clearConnectorRegistry,
  getConnectorById,
  getConnectors,
  getRegistryVersion,
  hydrateConnectorRegistry,
  registerConnector,
} from "./registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnector(
  id: string,
  sourceType: "file" | "remote-api" = "file",
): AnyConnector {
  if (sourceType === "file") {
    return {
      id,
      name: `${id} Connector`,
      description: `Test connector for ${id}`,
      sourceType: "file",
      icon: `<svg data-id="${id}"></svg>`,
      accept: ".csv",
      maxSizeMB: 10,
      helperText: "",
      getFormFields: () => [],
      validate: () => ({ valid: true }),
      parse: async () => {
        throw new Error("not implemented");
      },
    } as unknown as AnyConnector;
  }
  return {
    id,
    name: `${id} Connector`,
    description: `Test connector for ${id}`,
    sourceType: "remote-api",
    icon: `<svg data-id="${id}"></svg>`,
    getFormFields: () => [],
    validate: () => ({ valid: true }),
    connect: async () => [],
    query: async () => {
      throw new Error("not implemented");
    },
  } as unknown as AnyConnector;
}

function makeCatalogEntry(
  id: string,
  sourceType: "file" | "remote-api" = "file",
): ConnectorCatalogEntry {
  return {
    id,
    name: `${id} Connector`,
    description: `Test connector for ${id}`,
    sourceType,
    icon: `<svg data-id="${id}"></svg>`,
    authKind: "none",
    formFields: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("connector registry", () => {
  beforeEach(() => {
    clearConnectorRegistry();
  });

  describe("registerConnector()", () => {
    it("increments registry version on first registration of a new id", () => {
      const v0 = getRegistryVersion();
      registerConnector(makeConnector("csv"));
      expect(getRegistryVersion()).toBe(v0 + 1);
    });

    it("does not increment version when re-registering the same id", () => {
      registerConnector(makeConnector("csv"));
      const v1 = getRegistryVersion();
      // Re-register same id (e.g. HMR / StrictMode double-invoke)
      registerConnector(makeConnector("csv"));
      expect(getRegistryVersion()).toBe(v1);
    });
  });

  describe("getConnectorById()", () => {
    it("returns the most-recently registered instance for an id", () => {
      const c1 = makeConnector("local");
      const c2 = makeConnector("local");
      registerConnector(c1);
      registerConnector(c2);
      expect(getConnectorById("local")).toBe(c2);
    });
  });

  describe("getConnectors()", () => {
    it("returns all registered connectors with no options", () => {
      registerConnector(makeConnector("local"));
      registerConnector(makeConnector("notion", "remote-api"));
      expect(getConnectors()).toHaveLength(2);
      expect(getConnectors().map((c) => c.id)).toEqual(["local", "notion"]);
    });

    it("filters by sourceType=file", () => {
      registerConnector(makeConnector("local", "file"));
      registerConnector(makeConnector("notion", "remote-api"));
      const files = getConnectors({ sourceType: "file" });
      expect(files).toHaveLength(1);
      expect(files[0]?.id).toBe("local");
    });
  });

  describe("hydrateConnectorRegistry()", () => {
    it("registers connectors for catalog entries with a matching factory", () => {
      const local = makeConnector("local");
      const notion = makeConnector("notion", "remote-api");
      hydrateConnectorRegistry(
        [makeCatalogEntry("local"), makeCatalogEntry("notion", "remote-api")],
        {
          local: () => local,
          notion: () => notion,
        },
      );
      expect(getConnectorById("local")).toBe(local);
      expect(getConnectorById("notion")).toBe(notion);
    });

    it("skips catalog entries with no matching factory without throwing", () => {
      const local = makeConnector("local");
      expect(() =>
        hydrateConnectorRegistry(
          [
            makeCatalogEntry("local"),
            makeCatalogEntry("unknown-server-only", "remote-api"),
          ],
          { local: () => local },
        ),
      ).not.toThrow();
      expect(getConnectorById("local")).toBe(local);
      expect(getConnectorById("unknown-server-only")).toBeUndefined();
    });
  });

  describe("getRegistryVersion()", () => {
    it("bumps when the registry is cleared so subscribers re-render", () => {
      // useSyncExternalStore ignores a notification when the snapshot value is
      // unchanged, so clearing must change the version — otherwise a subscribed
      // component would not re-render and would keep showing stale connectors.
      registerConnector(makeConnector("local"));
      const v = getRegistryVersion();
      clearConnectorRegistry();
      expect(getRegistryVersion()).toBe(v + 1);
    });
  });
});

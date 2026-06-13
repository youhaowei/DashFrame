/**
 * Unit tests for the connector registry module.
 *
 * Contracts verified:
 * - registerConnector() stores a connector and makes it retrievable
 * - getConnectorById() returns the registered connector by id
 * - hasConnector() reflects registration state
 * - getConnectorIds() / getConnectors() enumerate registered kinds
 * - Registering the same id twice is idempotent (no duplicate; version unchanged)
 * - clearConnectorRegistry() resets the map and bumps the version (so
 *   subscribers re-render); re-registration works afterward
 * - getRegistryVersion() increments on a genuinely new id or a clear, not on
 *   read-only ops or same-id re-registration
 * - Known connector kinds (local, notion) are resolvable after boot registration
 */

import { localFileConnector } from "@dashframe/connector-local";
import { notionConnector } from "@dashframe/connector-notion";
import type { AnyConnector } from "@dashframe/engine";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearConnectorRegistry,
  getConnectorById,
  getConnectorIds,
  getConnectors,
  getRegistryVersion,
  hasConnector,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("connector registry", () => {
  beforeEach(() => {
    clearConnectorRegistry();
  });

  describe("registerConnector()", () => {
    it("stores the connector so it can be retrieved by id", () => {
      const c = makeConnector("csv");
      registerConnector(c);
      expect(getConnectorById("csv")).toBe(c);
    });

    it("makes the id resolvable via hasConnector()", () => {
      registerConnector(makeConnector("csv"));
      expect(hasConnector("csv")).toBe(true);
    });

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

    it("replaces the previous entry on re-registration", () => {
      const c1 = makeConnector("csv");
      const c2 = makeConnector("csv");
      registerConnector(c1);
      registerConnector(c2);
      expect(getConnectorById("csv")).toBe(c2);
    });

    it("registers multiple independent connector kinds", () => {
      registerConnector(makeConnector("local"));
      registerConnector(makeConnector("notion", "remote-api"));
      expect(hasConnector("local")).toBe(true);
      expect(hasConnector("notion")).toBe(true);
    });

    it("increments version once per genuinely new id", () => {
      const v0 = getRegistryVersion();
      registerConnector(makeConnector("local"));
      registerConnector(makeConnector("notion", "remote-api"));
      expect(getRegistryVersion()).toBe(v0 + 2);
    });
  });

  describe("getConnectorById()", () => {
    it("returns the registered connector", () => {
      const c = makeConnector("local");
      registerConnector(c);
      expect(getConnectorById("local")).toBe(c);
    });

    it("returns the most-recently registered instance for an id", () => {
      const c1 = makeConnector("local");
      const c2 = makeConnector("local");
      registerConnector(c1);
      registerConnector(c2);
      expect(getConnectorById("local")).toBe(c2);
    });

    it("returns undefined for an unregistered id", () => {
      expect(getConnectorById("unknown")).toBeUndefined();
    });

    it("returns undefined for an id that was never registered even when others exist", () => {
      registerConnector(makeConnector("local"));
      expect(getConnectorById("notion")).toBeUndefined();
    });
  });

  describe("hasConnector()", () => {
    it("returns false when the registry is empty", () => {
      expect(hasConnector("local")).toBe(false);
    });

    it("returns true after the connector is registered", () => {
      registerConnector(makeConnector("local"));
      expect(hasConnector("local")).toBe(true);
    });

    it("returns false for an id not in the registry", () => {
      registerConnector(makeConnector("local"));
      expect(hasConnector("notion")).toBe(false);
    });
  });

  describe("getConnectorIds()", () => {
    it("returns an empty array when the registry is empty", () => {
      expect(getConnectorIds()).toEqual([]);
    });

    it("returns all registered ids", () => {
      registerConnector(makeConnector("local"));
      registerConnector(makeConnector("notion", "remote-api"));
      const ids = getConnectorIds();
      expect(ids).toContain("local");
      expect(ids).toContain("notion");
      expect(ids).toHaveLength(2);
    });

    it("does not duplicate ids on re-registration", () => {
      registerConnector(makeConnector("local"));
      registerConnector(makeConnector("local"));
      expect(getConnectorIds()).toEqual(["local"]);
    });
  });

  describe("getConnectors()", () => {
    it("returns all non-feature-flagged connectors with no options", () => {
      // notion is feature-flagged off by default; only local is visible
      registerConnector(makeConnector("local"));
      registerConnector(makeConnector("notion", "remote-api"));
      expect(getConnectors()).toHaveLength(1);
      expect(getConnectors()[0]?.id).toBe("local");
    });

    it("returns all connectors when showNotion is explicitly true", () => {
      registerConnector(makeConnector("local"));
      registerConnector(makeConnector("notion", "remote-api"));
      expect(getConnectors({ showNotion: true })).toHaveLength(2);
    });

    it("filters by sourceType=file", () => {
      registerConnector(makeConnector("local", "file"));
      registerConnector(makeConnector("notion", "remote-api"));
      const files = getConnectors({ sourceType: "file" });
      expect(files).toHaveLength(1);
      expect(files[0]?.id).toBe("local");
    });

    it("filters by sourceType=remote-api with showNotion enabled", () => {
      // notion is the only remote-api connector; must enable showNotion to see it
      registerConnector(makeConnector("local", "file"));
      registerConnector(makeConnector("notion", "remote-api"));
      const remotes = getConnectors({
        sourceType: "remote-api",
        showNotion: true,
      });
      expect(remotes).toHaveLength(1);
      expect(remotes[0]?.id).toBe("notion");
    });

    it("excludes notion when showNotion is false (default)", () => {
      registerConnector(makeConnector("local", "file"));
      registerConnector(makeConnector("notion", "remote-api"));
      const visible = getConnectors({ showNotion: false });
      expect(visible.some((c) => c.id === "notion")).toBe(false);
    });

    it("includes notion when showNotion is true", () => {
      registerConnector(makeConnector("local", "file"));
      registerConnector(makeConnector("notion", "remote-api"));
      const visible = getConnectors({ showNotion: true });
      expect(visible.some((c) => c.id === "notion")).toBe(true);
    });
  });

  describe("clearConnectorRegistry()", () => {
    it("removes all registered connectors", () => {
      registerConnector(makeConnector("local"));
      registerConnector(makeConnector("notion", "remote-api"));
      clearConnectorRegistry();
      expect(getConnectorIds()).toEqual([]);
      expect(hasConnector("local")).toBe(false);
    });

    it("allows re-registration after clearing", () => {
      registerConnector(makeConnector("local"));
      clearConnectorRegistry();
      registerConnector(makeConnector("local"));
      expect(hasConnector("local")).toBe(true);
    });

    it("does not throw when clearing an empty registry", () => {
      expect(() => clearConnectorRegistry()).not.toThrow();
    });
  });

  describe("getRegistryVersion()", () => {
    it("returns a non-negative integer", () => {
      expect(getRegistryVersion()).toBeGreaterThanOrEqual(0);
    });

    it("does not change on read-only operations", () => {
      registerConnector(makeConnector("local"));
      const v = getRegistryVersion();
      getConnectorById("local");
      hasConnector("local");
      getConnectorIds();
      getConnectors();
      expect(getRegistryVersion()).toBe(v);
    });

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

  describe("boot registration — known connector kinds", () => {
    it("'local' connector is resolvable after registration with correct metadata", () => {
      registerConnector(localFileConnector);

      const c = getConnectorById("local");
      expect(c).toBeDefined();
      expect(c?.id).toBe("local");
      expect(c?.name).toBeTruthy();
      expect(c?.icon).toBeTruthy();
      expect(c?.sourceType).toBe("file");
    });

    it("'notion' connector is resolvable after registration with correct metadata", () => {
      registerConnector(notionConnector);

      const c = getConnectorById("notion");
      expect(c).toBeDefined();
      expect(c?.id).toBe("notion");
      expect(c?.name).toBeTruthy();
      expect(c?.icon).toBeTruthy();
      expect(c?.sourceType).toBe("remote-api");
    });

    it("both known kinds are resolvable when registered together", () => {
      registerConnector(localFileConnector);
      registerConnector(notionConnector);

      expect(getConnectorById("local")).toBeDefined();
      expect(getConnectorById("notion")).toBeDefined();
      expect(getConnectorIds()).toHaveLength(2);
    });
  });
});

/**
 * Unit tests for registry module
 *
 * Tests cover:
 * - registerRenderer() - Registering chart renderers for types
 * - getRenderer() - Retrieving registered renderers
 * - hasRenderer() - Checking if type has renderer
 * - getRegisteredTypes() - Listing all registered types
 * - clearRegistry() - Clearing all registered renderers
 * - getRegistryVersion() - Getting registry version counter
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartRenderer } from "@dashframe/core";
import type { VisualizationType } from "@dashframe/types";
import {
  clearRegistry,
  getRegisteredTypes,
  getRegistryVersion,
  getRenderer,
  hasRenderer,
  registerRenderer,
} from "./registry";

describe("registry", () => {
  // Clean up registry before each test to ensure isolation
  beforeEach(() => {
    clearRegistry();
  });

  // Sample renderers for testing
  const createMockRenderer = (
    types: readonly VisualizationType[],
  ): ChartRenderer => ({
    supportedTypes: types,
    render: vi.fn(() => vi.fn()), // Returns cleanup function
  });

  const barRenderer = createMockRenderer(["barY", "barX"]);
  const lineRenderer = createMockRenderer(["line"]);
  const multiRenderer = createMockRenderer(["dot", "hexbin", "heatmap"]);

  describe("registerRenderer()", () => {
    describe("single type registration", () => {
      it("should register renderer for single type", () => {
        registerRenderer(lineRenderer);
        expect(hasRenderer("line")).toBe(true);
      });

      it("should make renderer retrievable after registration", () => {
        registerRenderer(lineRenderer);
        const retrieved = getRenderer("line");
        expect(retrieved).toBe(lineRenderer);
      });

      it("should increment registry version on first registration", () => {
        const versionBefore = getRegistryVersion();
        registerRenderer(lineRenderer);
        const versionAfter = getRegistryVersion();
        expect(versionAfter).toBe(versionBefore + 1);
      });
    });

    describe("multiple type registration", () => {
      it("should register renderer for multiple types", () => {
        registerRenderer(barRenderer);
        expect(hasRenderer("barY")).toBe(true);
        expect(hasRenderer("barX")).toBe(true);
      });

      it("should make same renderer instance available for all types", () => {
        registerRenderer(barRenderer);
        const barYRenderer = getRenderer("barY");
        const barXRenderer = getRenderer("barX");
        expect(barYRenderer).toBe(barRenderer);
        expect(barXRenderer).toBe(barRenderer);
        expect(barYRenderer).toBe(barXRenderer);
      });

      it("should register renderer for many types", () => {
        registerRenderer(multiRenderer);
        expect(hasRenderer("dot")).toBe(true);
        expect(hasRenderer("hexbin")).toBe(true);
        expect(hasRenderer("heatmap")).toBe(true);
      });
    });

    describe("overwriting existing registrations", () => {
      it("should overwrite existing renderer for same type", () => {
        const renderer1 = createMockRenderer(["line"]);
        const renderer2 = createMockRenderer(["line"]);

        registerRenderer(renderer1);
        expect(getRenderer("line")).toBe(renderer1);

        registerRenderer(renderer2);
        expect(getRenderer("line")).toBe(renderer2);
      });

      it("should not increment version when re-registering same types", () => {
        const renderer1 = createMockRenderer(["line"]);
        const renderer2 = createMockRenderer(["line"]);

        registerRenderer(renderer1);
        const versionAfterFirst = getRegistryVersion();

        registerRenderer(renderer2);
        const versionAfterSecond = getRegistryVersion();

        // Version should not increment when overwriting existing types
        expect(versionAfterSecond).toBe(versionAfterFirst);
      });

      it("should increment version when adding new types along with existing", () => {
        const renderer1 = createMockRenderer(["line"]);
        const renderer2 = createMockRenderer(["line", "areaY"]);

        registerRenderer(renderer1);
        const versionAfterFirst = getRegistryVersion();

        registerRenderer(renderer2);
        const versionAfterSecond = getRegistryVersion();

        // Version should increment because "areaY" is a new type
        expect(versionAfterSecond).toBe(versionAfterFirst + 1);
      });
    });

    describe("multiple renderer registration", () => {
      it("should register multiple independent renderers", () => {
        registerRenderer(barRenderer);
        registerRenderer(lineRenderer);
        registerRenderer(multiRenderer);

        expect(hasRenderer("barY")).toBe(true);
        expect(hasRenderer("line")).toBe(true);
        expect(hasRenderer("dot")).toBe(true);
      });

      it("should increment version for each new renderer", () => {
        const version0 = getRegistryVersion();
        registerRenderer(barRenderer);
        const version1 = getRegistryVersion();
        registerRenderer(lineRenderer);
        const version2 = getRegistryVersion();
        registerRenderer(multiRenderer);
        const version3 = getRegistryVersion();

        expect(version1).toBe(version0 + 1);
        expect(version2).toBe(version1 + 1);
        expect(version3).toBe(version2 + 1);
      });
    });
  });

  describe("getRenderer()", () => {
    describe("retrieving registered renderers", () => {
      it("should return renderer for registered type", () => {
        registerRenderer(lineRenderer);
        const retrieved = getRenderer("line");
        expect(retrieved).toBe(lineRenderer);
      });

      it("should return correct renderer for each registered type", () => {
        registerRenderer(barRenderer);
        registerRenderer(lineRenderer);

        expect(getRenderer("barY")).toBe(barRenderer);
        expect(getRenderer("barX")).toBe(barRenderer);
        expect(getRenderer("line")).toBe(lineRenderer);
      });

      it("should return most recently registered renderer for type", () => {
        const renderer1 = createMockRenderer(["line"]);
        const renderer2 = createMockRenderer(["line"]);

        registerRenderer(renderer1);
        registerRenderer(renderer2);

        expect(getRenderer("line")).toBe(renderer2);
      });
    });

    describe("unregistered types", () => {
      it("should return undefined for unregistered type", () => {
        const retrieved = getRenderer("line");
        expect(retrieved).toBeUndefined();
      });

      it("should return undefined for unregistered type when registry has other types", () => {
        registerRenderer(barRenderer);
        const retrieved = getRenderer("line");
        expect(retrieved).toBeUndefined();
      });
    });
  });

  describe("hasRenderer()", () => {
    describe("registered types", () => {
      it("should return true for registered type", () => {
        registerRenderer(lineRenderer);
        expect(hasRenderer("line")).toBe(true);
      });

      it("should return true for all types of multi-type renderer", () => {
        registerRenderer(barRenderer);
        expect(hasRenderer("barY")).toBe(true);
        expect(hasRenderer("barX")).toBe(true);
      });

      it("should return true for each independently registered type", () => {
        registerRenderer(barRenderer);
        registerRenderer(lineRenderer);
        registerRenderer(multiRenderer);

        expect(hasRenderer("barY")).toBe(true);
        expect(hasRenderer("line")).toBe(true);
        expect(hasRenderer("dot")).toBe(true);
      });
    });

    describe("unregistered types", () => {
      it("should return false for unregistered type when registry is empty", () => {
        expect(hasRenderer("line")).toBe(false);
      });

      it("should return false for unregistered type when registry has other types", () => {
        registerRenderer(barRenderer);
        expect(hasRenderer("line")).toBe(false);
        expect(hasRenderer("dot")).toBe(false);
      });
    });

    describe("after overwriting", () => {
      it("should still return true after renderer is overwritten", () => {
        const renderer1 = createMockRenderer(["line"]);
        const renderer2 = createMockRenderer(["line"]);

        registerRenderer(renderer1);
        registerRenderer(renderer2);

        expect(hasRenderer("line")).toBe(true);
      });
    });
  });

  describe("getRegisteredTypes()", () => {
    describe("empty registry", () => {
      it("should return empty array for empty registry", () => {
        const types = getRegisteredTypes();
        expect(types).toEqual([]);
      });
    });

    describe("single renderer", () => {
      it("should return single type for single-type renderer", () => {
        registerRenderer(lineRenderer);
        const types = getRegisteredTypes();
        expect(types).toEqual(["line"]);
      });

      it("should return multiple types for multi-type renderer", () => {
        registerRenderer(barRenderer);
        const types = getRegisteredTypes();
        expect(types).toHaveLength(2);
        expect(types).toContain("barY");
        expect(types).toContain("barX");
      });
    });

    describe("multiple renderers", () => {
      it("should return all types from multiple renderers", () => {
        registerRenderer(barRenderer);
        registerRenderer(lineRenderer);
        registerRenderer(multiRenderer);

        const types = getRegisteredTypes();
        expect(types).toHaveLength(6);
        expect(types).toContain("barY");
        expect(types).toContain("barX");
        expect(types).toContain("line");
        expect(types).toContain("dot");
        expect(types).toContain("hexbin");
        expect(types).toContain("heatmap");
      });
    });

    describe("after overwriting", () => {
      it("should not duplicate types when renderer is overwritten", () => {
        const renderer1 = createMockRenderer(["line"]);
        const renderer2 = createMockRenderer(["line"]);

        registerRenderer(renderer1);
        registerRenderer(renderer2);

        const types = getRegisteredTypes();
        expect(types).toEqual(["line"]);
      });

      it("should return correct count when some types are overwritten", () => {
        registerRenderer(barRenderer); // barY, barX
        registerRenderer(lineRenderer); // line
        registerRenderer(createMockRenderer(["barY"])); // Overwrite barY

        const types = getRegisteredTypes();
        expect(types).toHaveLength(3);
        expect(types).toContain("barY");
        expect(types).toContain("barX");
        expect(types).toContain("line");
      });
    });
  });

  describe("clearRegistry()", () => {
    describe("clearing registered renderers", () => {
      it("should clear all registered renderers", () => {
        registerRenderer(barRenderer);
        registerRenderer(lineRenderer);

        clearRegistry();

        expect(hasRenderer("barY")).toBe(false);
        expect(hasRenderer("barX")).toBe(false);
        expect(hasRenderer("line")).toBe(false);
      });

      it("should return undefined for all previously registered types", () => {
        registerRenderer(barRenderer);
        registerRenderer(lineRenderer);

        clearRegistry();

        expect(getRenderer("barY")).toBeUndefined();
        expect(getRenderer("line")).toBeUndefined();
      });

      it("should return empty array from getRegisteredTypes", () => {
        registerRenderer(barRenderer);
        registerRenderer(lineRenderer);

        clearRegistry();

        const types = getRegisteredTypes();
        expect(types).toEqual([]);
      });
    });

    describe("clearing empty registry", () => {
      it("should not throw when clearing empty registry", () => {
        expect(() => clearRegistry()).not.toThrow();
      });
    });

    describe("re-registering after clear", () => {
      it("should allow re-registering after clear", () => {
        registerRenderer(lineRenderer);
        clearRegistry();
        registerRenderer(lineRenderer);

        expect(hasRenderer("line")).toBe(true);
        expect(getRenderer("line")).toBe(lineRenderer);
      });

      it("should increment version when re-registering after clear", () => {
        registerRenderer(lineRenderer);
        clearRegistry();

        const versionBefore = getRegistryVersion();
        registerRenderer(lineRenderer);
        const versionAfter = getRegistryVersion();

        expect(versionAfter).toBe(versionBefore + 1);
      });
    });
  });

  describe("getRegistryVersion()", () => {
    describe("version tracking", () => {
      it("should return initial version", () => {
        const version = getRegistryVersion();
        expect(typeof version).toBe("number");
        expect(version).toBeGreaterThanOrEqual(0);
      });

      it("should increment version when registering new renderer", () => {
        const versionBefore = getRegistryVersion();
        registerRenderer(lineRenderer);
        const versionAfter = getRegistryVersion();

        expect(versionAfter).toBe(versionBefore + 1);
      });

      it("should increment version for each new renderer with new types", () => {
        const version0 = getRegistryVersion();
        registerRenderer(barRenderer);
        const version1 = getRegistryVersion();
        registerRenderer(lineRenderer);
        const version2 = getRegistryVersion();

        expect(version1).toBeGreaterThan(version0);
        expect(version2).toBeGreaterThan(version1);
      });

      it("should not increment version when re-registering same types", () => {
        const renderer1 = createMockRenderer(["line"]);
        const renderer2 = createMockRenderer(["line"]);

        registerRenderer(renderer1);
        const versionAfterFirst = getRegistryVersion();

        registerRenderer(renderer2);
        const versionAfterSecond = getRegistryVersion();

        expect(versionAfterSecond).toBe(versionAfterFirst);
      });

      it("should increment version only once for multi-type renderer", () => {
        const versionBefore = getRegistryVersion();
        registerRenderer(barRenderer); // Registers barY and barX
        const versionAfter = getRegistryVersion();

        expect(versionAfter).toBe(versionBefore + 1);
      });
    });

    describe("version persistence", () => {
      it("should maintain version across getRegistryVersion calls", () => {
        registerRenderer(lineRenderer);
        const version1 = getRegistryVersion();
        const version2 = getRegistryVersion();
        const version3 = getRegistryVersion();

        expect(version1).toBe(version2);
        expect(version2).toBe(version3);
      });

      it("should not increment version when retrieving renderers", () => {
        registerRenderer(lineRenderer);
        const versionBefore = getRegistryVersion();

        getRenderer("line");
        hasRenderer("line");
        getRegisteredTypes();

        const versionAfter = getRegistryVersion();
        expect(versionAfter).toBe(versionBefore);
      });

      it("should not increment version when clearing registry", () => {
        registerRenderer(lineRenderer);
        const versionBefore = getRegistryVersion();

        clearRegistry();

        const versionAfter = getRegistryVersion();
        expect(versionAfter).toBe(versionBefore);
      });
    });
  });

  describe("integration - complete workflow", () => {
    it("should handle register → get → has workflow", () => {
      registerRenderer(lineRenderer);

      const hasLine = hasRenderer("line");
      expect(hasLine).toBe(true);

      const renderer = getRenderer("line");
      expect(renderer).toBe(lineRenderer);
    });

    it("should handle multiple registrations and queries", () => {
      registerRenderer(barRenderer);
      registerRenderer(lineRenderer);
      registerRenderer(multiRenderer);

      const types = getRegisteredTypes();
      expect(types).toHaveLength(6);

      expect(getRenderer("barY")).toBe(barRenderer);
      expect(getRenderer("line")).toBe(lineRenderer);
      expect(getRenderer("dot")).toBe(multiRenderer);
    });

    it("should handle register → clear → register workflow", () => {
      registerRenderer(lineRenderer);
      expect(hasRenderer("line")).toBe(true);

      clearRegistry();
      expect(hasRenderer("line")).toBe(false);

      registerRenderer(barRenderer);
      expect(hasRenderer("barY")).toBe(true);
      expect(hasRenderer("line")).toBe(false);
    });

    it("should track version throughout workflow", () => {
      const v0 = getRegistryVersion();

      registerRenderer(lineRenderer);
      const v1 = getRegistryVersion();
      expect(v1).toBe(v0 + 1);

      registerRenderer(barRenderer);
      const v2 = getRegistryVersion();
      expect(v2).toBe(v1 + 1);

      clearRegistry();
      const v3 = getRegistryVersion();
      expect(v3).toBe(v2); // Clear doesn't increment

      registerRenderer(lineRenderer);
      const v4 = getRegistryVersion();
      expect(v4).toBe(v3 + 1);
    });
  });

  describe("type safety guarantees", () => {
    it("should handle all valid visualization types", () => {
      const allTypesRenderer = createMockRenderer([
        "barY",
        "barX",
        "line",
        "areaY",
        "dot",
        "hexbin",
        "heatmap",
        "raster",
      ]);

      registerRenderer(allTypesRenderer);

      const types = getRegisteredTypes();
      expect(types).toHaveLength(8);
      expect(types).toContain("barY");
      expect(types).toContain("barX");
      expect(types).toContain("line");
      expect(types).toContain("areaY");
      expect(types).toContain("dot");
      expect(types).toContain("hexbin");
      expect(types).toContain("heatmap");
      expect(types).toContain("raster");
    });

    it("should preserve renderer reference identity", () => {
      registerRenderer(lineRenderer);

      const retrieved1 = getRenderer("line");
      const retrieved2 = getRenderer("line");

      expect(retrieved1).toBe(lineRenderer);
      expect(retrieved2).toBe(lineRenderer);
      expect(retrieved1).toBe(retrieved2);
    });

    it("should maintain independent registrations", () => {
      registerRenderer(barRenderer);
      registerRenderer(lineRenderer);

      const barY = getRenderer("barY");
      const line = getRenderer("line");

      expect(barY).toBe(barRenderer);
      expect(line).toBe(lineRenderer);
      expect(barY).not.toBe(line);
    });
  });
});

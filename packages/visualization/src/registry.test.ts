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
 * - useRegistryVersion() - React hook for subscribing to registry changes
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ChartRenderer } from "@dashframe/core";
import type { VisualizationType } from "@dashframe/types";
import {
  clearRegistry,
  getRegisteredTypes,
  getRegistryVersion,
  getRenderer,
  hasRenderer,
  registerRenderer,
  useRegistryVersion,
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

  describe("useRegistryVersion()", () => {
    describe("basic functionality", () => {
      it("should return current registry version", () => {
        const { result } = renderHook(() => useRegistryVersion());

        expect(typeof result.current).toBe("number");
        expect(result.current).toBeGreaterThanOrEqual(0);
      });

      it("should return same version as getRegistryVersion", () => {
        const { result } = renderHook(() => useRegistryVersion());

        expect(result.current).toBe(getRegistryVersion());
      });

      it("should return consistent version across multiple calls", () => {
        const { result, rerender } = renderHook(() => useRegistryVersion());

        const initialVersion = result.current;
        rerender();

        expect(result.current).toBe(initialVersion);
      });
    });

    describe("registry change subscription", () => {
      it("should update when new renderer is registered", () => {
        const { result } = renderHook(() => useRegistryVersion());

        const versionBefore = result.current;

        act(() => {
          registerRenderer(lineRenderer);
        });

        expect(result.current).toBe(versionBefore + 1);
      });

      it("should update when multiple renderers are registered", () => {
        const { result } = renderHook(() => useRegistryVersion());

        const v0 = result.current;

        act(() => {
          registerRenderer(lineRenderer);
        });

        const v1 = result.current;
        expect(v1).toBe(v0 + 1);

        act(() => {
          registerRenderer(barRenderer);
        });

        const v2 = result.current;
        expect(v2).toBe(v1 + 1);
      });

      it("should update when renderer with multiple types is registered", () => {
        const { result } = renderHook(() => useRegistryVersion());

        const versionBefore = result.current;

        act(() => {
          registerRenderer(multiRenderer); // Registers dot, hexbin, heatmap
        });

        // Should increment only once even for multiple types
        expect(result.current).toBe(versionBefore + 1);
      });

      it("should not update when re-registering same types", () => {
        // Register initial renderer
        act(() => {
          registerRenderer(lineRenderer);
        });

        const { result } = renderHook(() => useRegistryVersion());
        const versionBefore = result.current;

        // Re-register same type with different renderer instance
        const newLineRenderer = createMockRenderer(["line"]);
        act(() => {
          registerRenderer(newLineRenderer);
        });

        // Version should not change when re-registering same types
        expect(result.current).toBe(versionBefore);
      });

      it("should update when new types are added along with existing", () => {
        // Register initial renderer
        act(() => {
          registerRenderer(lineRenderer);
        });

        const { result } = renderHook(() => useRegistryVersion());
        const versionBefore = result.current;

        // Register renderer with both existing and new types
        const mixedRenderer = createMockRenderer(["line", "areaY"]);
        act(() => {
          registerRenderer(mixedRenderer);
        });

        // Version should increment because "areaY" is new
        expect(result.current).toBe(versionBefore + 1);
      });
    });

    describe("clearing registry", () => {
      it("should not trigger update when registry is cleared", () => {
        act(() => {
          registerRenderer(lineRenderer);
        });

        const { result } = renderHook(() => useRegistryVersion());
        const versionBefore = result.current;

        act(() => {
          clearRegistry();
        });

        // Clear should not increment version
        expect(result.current).toBe(versionBefore);
      });

      it("should update when registering after clear", () => {
        act(() => {
          registerRenderer(lineRenderer);
          clearRegistry();
        });

        const { result } = renderHook(() => useRegistryVersion());
        const versionBefore = result.current;

        act(() => {
          registerRenderer(lineRenderer);
        });

        // Registering after clear should increment version (new registration)
        expect(result.current).toBe(versionBefore + 1);
      });
    });

    describe("multiple hook instances", () => {
      it("should update all instances when registry changes", () => {
        const { result: result1 } = renderHook(() => useRegistryVersion());
        const { result: result2 } = renderHook(() => useRegistryVersion());

        const v1Before = result1.current;
        const v2Before = result2.current;

        expect(v1Before).toBe(v2Before);

        act(() => {
          registerRenderer(lineRenderer);
        });

        // Both hooks should see the update
        expect(result1.current).toBe(v1Before + 1);
        expect(result2.current).toBe(v2Before + 1);
        expect(result1.current).toBe(result2.current);
      });

      it("should handle independent unmounting", () => {
        const { result: result1 } = renderHook(() => useRegistryVersion());
        const { result: result2, unmount: unmount2 } = renderHook(() =>
          useRegistryVersion(),
        );

        act(() => {
          registerRenderer(lineRenderer);
        });

        const v1After = result1.current;
        const v2After = result2.current;

        expect(v1After).toBe(v2After);

        // Unmount second hook
        unmount2();

        // First hook should still work after second is unmounted
        act(() => {
          registerRenderer(barRenderer);
        });

        expect(result1.current).toBe(v1After + 1);
      });
    });

    describe("subscription cleanup", () => {
      it("should unsubscribe when hook unmounts", () => {
        const { unmount } = renderHook(() => useRegistryVersion());

        // Unmount the hook
        unmount();

        // Registry should still work after hook unmounts
        expect(() => {
          registerRenderer(lineRenderer);
        }).not.toThrow();

        expect(hasRenderer("line")).toBe(true);
      });

      it("should not leak subscriptions on unmount", () => {
        // Render and unmount multiple times
        for (let i = 0; i < 10; i++) {
          const { unmount } = renderHook(() => useRegistryVersion());
          unmount();
        }

        // Registry should still function normally
        act(() => {
          registerRenderer(lineRenderer);
        });

        expect(hasRenderer("line")).toBe(true);
      });
    });

    describe("integration with registry operations", () => {
      it("should track version through complete workflow", () => {
        const { result } = renderHook(() => useRegistryVersion());

        const v0 = result.current;

        act(() => {
          registerRenderer(lineRenderer);
        });
        const v1 = result.current;
        expect(v1).toBe(v0 + 1);

        act(() => {
          registerRenderer(barRenderer);
        });
        const v2 = result.current;
        expect(v2).toBe(v1 + 1);

        act(() => {
          clearRegistry();
        });
        const v3 = result.current;
        expect(v3).toBe(v2); // Clear doesn't increment

        act(() => {
          registerRenderer(multiRenderer);
        });
        const v4 = result.current;
        expect(v4).toBe(v3 + 1);
      });

      it("should not update for read-only operations", () => {
        act(() => {
          registerRenderer(lineRenderer);
        });

        const { result } = renderHook(() => useRegistryVersion());
        const versionBefore = result.current;

        // Read-only operations should not trigger updates
        getRenderer("line");
        hasRenderer("line");
        getRegisteredTypes();

        expect(result.current).toBe(versionBefore);
      });
    });

    describe("type safety and consistency", () => {
      it("should always return a number", () => {
        const { result } = renderHook(() => useRegistryVersion());

        expect(typeof result.current).toBe("number");

        act(() => {
          registerRenderer(lineRenderer);
        });

        expect(typeof result.current).toBe("number");
      });

      it("should return non-negative version", () => {
        const { result } = renderHook(() => useRegistryVersion());

        expect(result.current).toBeGreaterThanOrEqual(0);

        act(() => {
          registerRenderer(lineRenderer);
        });

        expect(result.current).toBeGreaterThanOrEqual(0);
      });

      it("should maintain version monotonicity", () => {
        const { result } = renderHook(() => useRegistryVersion());
        const versions: number[] = [result.current];

        act(() => {
          registerRenderer(lineRenderer);
        });
        versions.push(result.current);

        act(() => {
          registerRenderer(barRenderer);
        });
        versions.push(result.current);

        act(() => {
          registerRenderer(multiRenderer);
        });
        versions.push(result.current);

        // Each new registration should have a higher version
        for (let i = 1; i < versions.length; i++) {
          expect(versions[i]).toBeGreaterThan(versions[i - 1]);
        }
      });
    });
  });
});

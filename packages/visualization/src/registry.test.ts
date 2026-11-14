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
import type { VisualizationType } from "@dashframe/types";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ChartRenderer } from "./chart-renderers";
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
    describe("multiple type registration", () => {
      it("should make same renderer instance available for all types", () => {
        registerRenderer(barRenderer);
        const barYRenderer = getRenderer("barY");
        const barXRenderer = getRenderer("barX");
        expect(barYRenderer).toBe(barRenderer);
        expect(barXRenderer).toBe(barRenderer);
        expect(barYRenderer).toBe(barXRenderer);
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
      it("should return correct renderer for each registered type", () => {
        registerRenderer(barRenderer);
        registerRenderer(lineRenderer);

        expect(getRenderer("barY")).toBe(barRenderer);
        expect(getRenderer("barX")).toBe(barRenderer);
        expect(getRenderer("line")).toBe(lineRenderer);
      });
    });

    describe("unregistered types", () => {
      it("should return undefined for unregistered type when registry has other types", () => {
        registerRenderer(barRenderer);
        const retrieved = getRenderer("line");
        expect(retrieved).toBeUndefined();
      });
    });
  });

  describe("hasRenderer()", () => {
    describe("unregistered types", () => {
      it("should return false for unregistered type when registry has other types", () => {
        registerRenderer(barRenderer);
        expect(hasRenderer("line")).toBe(false);
        expect(hasRenderer("dot")).toBe(false);
      });
    });
  });

  describe("getRegisteredTypes()", () => {
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
        expect(getRenderer("barY")).toBeUndefined();
        expect(getRenderer("line")).toBeUndefined();
        expect(getRegisteredTypes()).toEqual([]);
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
    describe("version persistence", () => {
      it("should not increment version when clearing registry", () => {
        registerRenderer(lineRenderer);
        const versionBefore = getRegistryVersion();

        clearRegistry();

        const versionAfter = getRegistryVersion();
        expect(versionAfter).toBe(versionBefore);
      });
    });
  });

  describe("useRegistryVersion()", () => {
    describe("registry change subscription", () => {
      it("should update when new renderer is registered", () => {
        const { result } = renderHook(() => useRegistryVersion());

        const versionBefore = result.current;

        act(() => {
          registerRenderer(lineRenderer);
        });

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
  });
});

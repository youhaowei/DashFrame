/**
 * Unit tests for registry module
 *
 * Tests cover:
 * - registerRenderer() - Registering chart renderers for types
 * - getRenderer() - Retrieving registered renderers
 * - getRegistryVersion() - Getting registry version counter
 * - useRegistryVersion() - React hook for subscribing to registry changes
 */
import type { VisualizationType } from "@dashframe/types";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ChartRenderer } from "./chart-renderers";
import {
  clearRegistry,
  getRegistryVersion,
  getRenderer,
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
    });
  });
});

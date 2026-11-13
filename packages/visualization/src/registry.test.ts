/**
 * Unit tests for registry module
 *
 * Tests cover:
 * - registerRenderer() - Registering chart renderers for types
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

  const lineRenderer = createMockRenderer(["line"]);

  describe("registerRenderer()", () => {
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

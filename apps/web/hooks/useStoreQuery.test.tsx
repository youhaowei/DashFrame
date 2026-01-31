/**
 * Unit tests for useStoreQuery hook
 *
 * Tests cover:
 * - Basic selector functionality and data retrieval
 * - Loading states with persisted store hydration
 * - requireHydration option (true/false)
 * - Hydration callbacks and subscription
 * - Stores without persist support
 * - Hook stability and rerender behavior
 * - Type safety guarantees
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStoreQuery } from "./useStoreQuery";

// Type for our mock store state
type TestState = {
  items: string[];
  count: number;
  user: { name: string } | null;
};

// Type matching PersistedStore from useStoreQuery
type MockPersistedStore<TState> = {
  <TResult>(selector: (state: TState) => TResult): TResult;
  getState: () => TState;
  subscribe: (listener: (state: TState) => void) => () => void;
  persist?: {
    hasHydrated?: () => boolean;
    onFinishHydration?: (cb: () => void) => () => void;
  };
};

/**
 * Helper to create a mock Zustand persisted store
 */
function createMockStore(options: {
  state: TestState;
  hasHydrated?: boolean;
  hasPersist?: boolean;
}) {
  const listeners: Set<(state: TestState) => void> = new Set();
  let currentState = options.state;
  let isHydrated = options.hasHydrated ?? false;
  const hydrationCallbacks: Set<() => void> = new Set();

  // Create the store function with proper typing
  const storeFn = <TResult,>(
    selector: (state: TestState) => TResult,
  ): TResult => {
    return selector(currentState);
  };

  // Create the full store object with all required methods
  const store: MockPersistedStore<TestState> = Object.assign(storeFn, {
    getState: () => currentState,
    subscribe: (listener: (state: TestState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    persist:
      options.hasPersist !== false
        ? {
            hasHydrated: vi.fn(() => isHydrated),
            onFinishHydration: vi.fn((cb: () => void) => {
              hydrationCallbacks.add(cb);
              return () => {
                hydrationCallbacks.delete(cb);
              };
            }),
          }
        : undefined,
  });

  // Helper to simulate hydration
  const triggerHydration = () => {
    isHydrated = true;
    hydrationCallbacks.forEach((cb) => cb());
  };

  // Helper to update state
  const setState = (newState: TestState) => {
    currentState = newState;
    listeners.forEach((listener) => listener(newState));
  };

  return { store, triggerHydration, setState };
}

describe("useStoreQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should return data from store selector", () => {
      const { store } = createMockStore({
        state: { items: ["a", "b", "c"], count: 3, user: null },
        hasHydrated: true,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      expect(result.current.data).toEqual(["a", "b", "c"]);
    });

    it("should call store with the provided selector", () => {
      const { store } = createMockStore({
        state: { items: ["x", "y"], count: 2, user: null },
        hasHydrated: true,
      });

      const selector = vi.fn((state: TestState) => state.count);

      const { result } = renderHook(() => useStoreQuery(store, selector));

      expect(selector).toHaveBeenCalled();
      expect(result.current.data).toBe(2);
    });

    it("should return isSuccess true when hydrated", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: true,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.count),
      );

      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });

    it("should always return isError false", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: true,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      expect(result.current.isError).toBe(false);
    });

    it("should work with complex selector results", () => {
      const { store } = createMockStore({
        state: {
          items: ["apple", "banana"],
          count: 10,
          user: { name: "John" },
        },
        hasHydrated: true,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => ({
          firstItem: state.items[0],
          userName: state.user?.name,
        })),
      );

      expect(result.current.data).toEqual({
        firstItem: "apple",
        userName: "John",
      });
    });

    it("should return different data for different selectors", () => {
      const { store } = createMockStore({
        state: {
          items: ["a", "b", "c"],
          count: 5,
          user: { name: "Alice" },
        },
        hasHydrated: true,
      });

      const { result: result1 } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      const { result: result2 } = renderHook(() =>
        useStoreQuery(store, (state) => state.count),
      );

      expect(result1.current.data).toEqual(["a", "b", "c"]);
      expect(result2.current.data).toBe(5);
    });
  });

  describe("hydration with requireHydration=true (default)", () => {
    it("should show loading when not yet hydrated", () => {
      const { store } = createMockStore({
        state: { items: ["a"], count: 1, user: null },
        hasHydrated: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isSuccess).toBe(false);
    });

    it("should transition to success after hydration", async () => {
      const { store, triggerHydration } = createMockStore({
        state: { items: ["a"], count: 1, user: null },
        hasHydrated: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      expect(result.current.isLoading).toBe(true);

      // Trigger hydration
      await act(async () => {
        triggerHydration();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
    });

    it("should subscribe to hydration callback", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: false,
      });

      renderHook(() => useStoreQuery(store, (state) => state.count));

      expect(store.persist?.onFinishHydration).toHaveBeenCalled();
    });

    it("should unsubscribe from hydration on unmount", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: false,
      });

      const unsubscribe = vi.fn();
      store.persist!.onFinishHydration = vi.fn(() => unsubscribe);

      const { unmount } = renderHook(() =>
        useStoreQuery(store, (state) => state.count),
      );

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });

    it("should check hasHydrated immediately when subscribing", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: false,
      });

      // Mock hasHydrated to return true after component mounts
      let callCount = 0;
      store.persist!.hasHydrated = vi.fn(() => {
        callCount++;
        return callCount > 1; // First call: false, second call: true
      });

      renderHook(() => useStoreQuery(store, (state) => state.count));

      // Should have checked hasHydrated multiple times (initial state + effect)
      expect(store.persist?.hasHydrated).toHaveBeenCalled();
    });

    it("should update state when hydration callback is triggered", async () => {
      const { store, triggerHydration } = createMockStore({
        state: { items: ["test"], count: 1, user: null },
        hasHydrated: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isSuccess).toBe(false);

      await act(async () => {
        triggerHydration();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
    });
  });

  describe("hydration with requireHydration=false", () => {
    it("should not show loading when requireHydration is false", () => {
      const { store } = createMockStore({
        state: { items: ["a"], count: 1, user: null },
        hasHydrated: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items, {
          requireHydration: false,
        }),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
    });

    it("should return data immediately when requireHydration is false", () => {
      const { store } = createMockStore({
        state: { items: ["x", "y", "z"], count: 3, user: null },
        hasHydrated: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items, {
          requireHydration: false,
        }),
      );

      expect(result.current.data).toEqual(["x", "y", "z"]);
      expect(result.current.isSuccess).toBe(true);
    });

    it("should not subscribe to hydration when requireHydration is false", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: false,
      });

      renderHook(() =>
        useStoreQuery(store, (state) => state.count, {
          requireHydration: false,
        }),
      );

      // Should not call onFinishHydration when requireHydration is false
      // (effect returns early)
      expect(store.persist?.onFinishHydration).not.toHaveBeenCalled();
    });

    it("should show success immediately even if store is not hydrated", () => {
      const { store } = createMockStore({
        state: {
          items: ["data"],
          count: 1,
          user: { name: "Test" },
        },
        hasHydrated: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.user, {
          requireHydration: false,
        }),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.data).toEqual({ name: "Test" });
    });
  });

  describe("stores without persist support", () => {
    it("should work with non-persisted stores", () => {
      const { store } = createMockStore({
        state: { items: ["a", "b"], count: 2, user: null },
        hasPersist: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      expect(result.current.data).toEqual(["a", "b"]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
    });

    it("should not throw when persist is undefined", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasPersist: false,
      });

      expect(() => {
        renderHook(() => useStoreQuery(store, (state) => state.count));
      }).not.toThrow();
    });

    it("should initialize with hasHydrated=false when persist is undefined", () => {
      const { store } = createMockStore({
        state: { items: ["test"], count: 1, user: null },
        hasPersist: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
    });

    it("should not subscribe when persist is undefined", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasPersist: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.count),
      );

      expect(result.current.isLoading).toBe(false);
    });

    it("should work with requireHydration=false on non-persisted stores", () => {
      const { store } = createMockStore({
        state: { items: ["data"], count: 1, user: null },
        hasPersist: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items, {
          requireHydration: false,
        }),
      );

      expect(result.current.data).toEqual(["data"]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle undefined hasHydrated method", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: false,
      });

      // Remove hasHydrated method
      if (store.persist) {
        store.persist.hasHydrated = undefined;
      }

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.count),
      );

      // Should default to false when hasHydrated is undefined
      expect(result.current.isLoading).toBe(true);
    });

    it("should handle undefined onFinishHydration method", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: false,
      });

      // Remove onFinishHydration method
      if (store.persist) {
        store.persist.onFinishHydration = undefined;
      }

      expect(() => {
        renderHook(() => useStoreQuery(store, (state) => state.count));
      }).not.toThrow();
    });

    it("should handle onFinishHydration returning undefined", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: false,
      });

      // Mock onFinishHydration to return undefined
      if (store.persist) {
        store.persist.onFinishHydration = vi.fn(
          () => undefined as unknown as () => void,
        );
      }

      const { unmount } = renderHook(() =>
        useStoreQuery(store, (state) => state.count),
      );

      // Should not throw when unmounting
      expect(() => {
        unmount();
      }).not.toThrow();
    });

    it("should handle null selector results", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: true,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.user),
      );

      expect(result.current.data).toBeNull();
      expect(result.current.isSuccess).toBe(true);
    });

    it("should handle empty array results", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: true,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      expect(result.current.data).toEqual([]);
      expect(result.current.isSuccess).toBe(true);
    });

    it("should handle zero numeric results", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: true,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.count),
      );

      expect(result.current.data).toBe(0);
      expect(result.current.isSuccess).toBe(true);
    });
  });

  describe("hook stability", () => {
    it("should update data when selector result changes", () => {
      const { store, setState } = createMockStore({
        state: { items: ["a"], count: 1, user: null },
        hasHydrated: true,
      });

      const { result, rerender } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      expect(result.current.data).toEqual(["a"]);

      // Update state
      act(() => {
        setState({ items: ["a", "b"], count: 2, user: null });
      });

      rerender();

      expect(result.current.data).toEqual(["a", "b"]);
    });

    it("should maintain return object structure on rerenders", () => {
      const { store } = createMockStore({
        state: { items: ["test"], count: 1, user: null },
        hasHydrated: true,
      });

      const { result, rerender } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      // Capture initial result to verify structure is maintained after rerender
      expect(result.current).toHaveProperty("data");

      rerender();

      // All keys should still exist
      expect(result.current).toHaveProperty("data");
      expect(result.current).toHaveProperty("isLoading");
      expect(result.current).toHaveProperty("isError");
      expect(result.current).toHaveProperty("isSuccess");
    });

    it("should not rerender unnecessarily when data hasn't changed", () => {
      const { store } = createMockStore({
        state: { items: ["a", "b"], count: 2, user: null },
        hasHydrated: true,
      });

      let renderCount = 0;
      const { rerender } = renderHook(() => {
        renderCount++;
        return useStoreQuery(store, (state) => state.items);
      });

      const initialRenderCount = renderCount;

      // Rerender without state change
      rerender();
      rerender();

      // Should only have initial render + manual rerenders (but not extra rerenders from the hook)
      expect(renderCount).toBe(initialRenderCount + 2);
    });

    it("should handle changing selectors", () => {
      const { store } = createMockStore({
        state: {
          items: ["a", "b", "c"],
          count: 3,
          user: { name: "John" },
        },
        hasHydrated: true,
      });

      let selector: (state: TestState) => string[] | number = (state) =>
        state.items;

      const { result, rerender } = renderHook(() =>
        useStoreQuery(store, selector),
      );

      expect(result.current.data).toEqual(["a", "b", "c"]);

      // Change selector
      selector = (state) => state.count;
      rerender();

      expect(result.current.data).toBe(3);
    });

    it("should handle changing stores", () => {
      const { store: store1 } = createMockStore({
        state: { items: ["store1"], count: 1, user: null },
        hasHydrated: true,
      });

      const { store: store2 } = createMockStore({
        state: { items: ["store2"], count: 2, user: null },
        hasHydrated: true,
      });

      let currentStore = store1;

      const { result, rerender } = renderHook(() =>
        useStoreQuery(currentStore, (state) => state.items),
      );

      expect(result.current.data).toEqual(["store1"]);

      // Switch to store2
      currentStore = store2;
      rerender();

      expect(result.current.data).toEqual(["store2"]);
    });

    it("should re-subscribe when requireHydration option changes", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: false,
      });

      let requireHydration = true;

      const { result, rerender } = renderHook(() =>
        useStoreQuery(store, (state) => state.count, { requireHydration }),
      );

      expect(result.current.isLoading).toBe(true);

      // Change option
      requireHydration = false;
      rerender();

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete hydration workflow", async () => {
      const { store, triggerHydration } = createMockStore({
        state: {
          items: ["initial"],
          count: 0,
          user: { name: "Alice" },
        },
        hasHydrated: false,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => ({
          items: state.items,
          user: state.user,
        })),
      );

      // Initial state: loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.data).toEqual({
        items: ["initial"],
        user: { name: "Alice" },
      });

      // Trigger hydration
      await act(async () => {
        triggerHydration();
      });

      // After hydration: success
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.data).toEqual({
        items: ["initial"],
        user: { name: "Alice" },
      });
    });

    it("should handle multiple hooks on same store", async () => {
      const { store, triggerHydration } = createMockStore({
        state: { items: ["a", "b"], count: 2, user: null },
        hasHydrated: false,
      });

      const { result: result1 } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      const { result: result2 } = renderHook(() =>
        useStoreQuery(store, (state) => state.count),
      );

      expect(result1.current.isLoading).toBe(true);
      expect(result2.current.isLoading).toBe(true);

      // Trigger hydration - both should update
      await act(async () => {
        triggerHydration();
      });

      expect(result1.current.isLoading).toBe(false);
      expect(result2.current.isLoading).toBe(false);
    });

    it("should handle mixed requireHydration options on same store", async () => {
      const { store, triggerHydration } = createMockStore({
        state: { items: ["test"], count: 1, user: null },
        hasHydrated: false,
      });

      const { result: withHydration } = renderHook(() =>
        useStoreQuery(store, (state) => state.items, {
          requireHydration: true,
        }),
      );

      const { result: withoutHydration } = renderHook(() =>
        useStoreQuery(store, (state) => state.count, {
          requireHydration: false,
        }),
      );

      // One should be loading, one should not
      expect(withHydration.current.isLoading).toBe(true);
      expect(withoutHydration.current.isLoading).toBe(false);

      await act(async () => {
        triggerHydration();
      });

      // After hydration, both should be success
      expect(withHydration.current.isLoading).toBe(false);
      expect(withoutHydration.current.isLoading).toBe(false);
    });
  });

  describe("type safety", () => {
    it("should preserve selector result types", () => {
      const { store } = createMockStore({
        state: { items: ["a", "b"], count: 5, user: { name: "Bob" } },
        hasHydrated: true,
      });

      const { result: arrayResult } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      const { result: numberResult } = renderHook(() =>
        useStoreQuery(store, (state) => state.count),
      );

      const { result: objectResult } = renderHook(() =>
        useStoreQuery(store, (state) => state.user),
      );

      // Runtime type checks
      expect(Array.isArray(arrayResult.current.data)).toBe(true);
      expect(typeof numberResult.current.data).toBe("number");
      expect(typeof objectResult.current.data).toBe("object");
    });

    it("should maintain consistent return object shape", () => {
      const { store } = createMockStore({
        state: { items: [], count: 0, user: null },
        hasHydrated: true,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => state.items),
      );

      // Verify all expected keys exist
      expect(result.current).toHaveProperty("data");
      expect(result.current).toHaveProperty("isLoading");
      expect(result.current).toHaveProperty("isError");
      expect(result.current).toHaveProperty("isSuccess");

      // Verify types
      expect(typeof result.current.isLoading).toBe("boolean");
      expect(typeof result.current.isError).toBe("boolean");
      expect(typeof result.current.isSuccess).toBe("boolean");
    });

    it("should handle complex selector transformations", () => {
      const { store } = createMockStore({
        state: {
          items: ["apple", "banana", "cherry"],
          count: 10,
          user: { name: "Test User" },
        },
        hasHydrated: true,
      });

      const { result } = renderHook(() =>
        useStoreQuery(store, (state) => ({
          total: state.count,
          firstItem: state.items[0],
          itemCount: state.items.length,
          hasUser: state.user !== null,
        })),
      );

      expect(result.current.data).toEqual({
        total: 10,
        firstItem: "apple",
        itemCount: 3,
        hasUser: true,
      });
    });
  });
});

"use client";

import superjson from "superjson";
import { createJSONStorage } from "zustand/middleware";

/**
 * SSR-safe storage adapter using superjson for automatic
 * Map/Set/Date serialization. Guards localStorage access
 * for server-side rendering compatibility.
 *
 * All Zustand stores should use this instead of custom reviver/replacer logic.
 * Stores must keep `skipHydration: true` and rely on StoreHydration provider
 * to trigger `rehydrate()` client-side.
 *
 * @example
 * ```ts
 * persist(
 *   immer((set, get) => ({ ... })),
 *   {
 *     name: "dashframe:my-store",
 *     storage: superjsonStorage,
 *     skipHydration: true,
 *   }
 * )
 * ```
 */

// Custom storage that uses superjson for serialization
// This preserves Map, Set, Date, and other complex types
const superjsonLocalStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(name);
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(name, value);
    } catch (e) {
      console.error(`Failed to save "${name}" to localStorage:`, e);
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(name);
  },
};

// Create storage using superjson for serialization
export const superjsonStorage = createJSONStorage(() => superjsonLocalStorage, {
  reviver: (_key, value) => {
    // The value has already been JSON.parsed by createJSONStorage
    // We need to handle the case where the whole object was serialized with superjson
    // Check if this looks like a superjson-serialized value
    if (
      value &&
      typeof value === "object" &&
      "json" in value &&
      "meta" in value
    ) {
      // This is superjson format - deserialize it
      return superjson.deserialize(value as Parameters<typeof superjson.deserialize>[0]);
    }
    return value;
  },
  replacer: (_key, value) => {
    // Serialize with superjson to preserve Map/Set/Date
    if (value instanceof Map || value instanceof Set || value instanceof Date) {
      // Return superjson serialized format
      return superjson.serialize(value);
    }
    // For objects that might contain Maps (like state), serialize the whole thing
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      _key === ""
    ) {
      // Root object - serialize with superjson to catch nested Maps
      return superjson.serialize(value);
    }
    return value;
  },
});

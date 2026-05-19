/**
 * @dashframe/core-store
 *
 * Stub package for storage backend selection.
 *
 * TypeScript sees the type declarations from @dashframe/core-dexie (default backend).
 * Vite replaces this module at build time based on the NEXT_PUBLIC_STORAGE_IMPL env var.
 *
 * @example
 * ```bash
 * # Use Dexie backend (default)
 * NEXT_PUBLIC_STORAGE_IMPL=dexie bun dev
 *
 * # Use custom backend
 * NEXT_PUBLIC_STORAGE_IMPL=custom bun dev
 * ```
 */

// Re-export all types and implementations from the default storage backend
// Vite will replace this entire module at build time
export * from "@dashframe/core-dexie";

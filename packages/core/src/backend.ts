/**
 * Storage selector module.
 *
 * This module re-exports from "@dashframe/core-store" which is a stub package
 * that gets aliased at build time to the chosen storage implementation.
 *
 * The alias is configured in:
 * - apps/web/vite.config.ts (Vite alias)
 *
 * Storage selection is controlled by the NEXT_PUBLIC_STORAGE_IMPL env var:
 * - "dexie" (default) → @dashframe/core-dexie
 * - "custom" → @dashframe/core-custom
 *
 * TypeScript sees hook declarations from @dashframe/core-dexie (via types.d.ts).
 * Vite replaces the runtime implementation based on the env var.
 * Only the selected storage implementation is bundled; others are tree-shaken away.
 */

// Stub package aliased at build time to the chosen storage implementation
export * from "@dashframe/core-store";

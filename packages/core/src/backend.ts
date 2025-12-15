/**
 * Backend selector module.
 *
 * This module selects the backend implementation based on the
 * NEXT_PUBLIC_DATA_BACKEND environment variable at build time.
 *
 * TypeScript sees all possible exports during development.
 * Next.js build replaces the env var with its actual value and
 * tree-shakes unused backend code.
 */

// Re-export from selected backend
// Currently only Dexie is available. When Convex is added:
//
// if (process.env.NEXT_PUBLIC_DATA_BACKEND === "convex") {
//   export * from "@dashframe/core-convex";
// } else {
//   export * from "@dashframe/core-dexie";
// }

export * from "@dashframe/core-dexie";

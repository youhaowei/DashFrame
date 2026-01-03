"use client";

import { useEffect, type ReactNode } from "react";
import {
  VisualizationProvider,
  useVisualization,
  registerRenderer,
  createVgplotRenderer,
} from "@dashframe/visualization";
import { useLazyDuckDB } from "./LazyDuckDBProvider";

// ============================================================================
// Renderer Registration
// ============================================================================

/**
 * Registers chart renderers when the visualization system is ready.
 * This component runs on mount and sets up the vgplot renderer.
 *
 * Note: registerRenderer() is idempotent - it only triggers re-renders
 * when registering genuinely new chart types, not when re-registering
 * existing types (e.g., during HMR or component remounts).
 */
function RendererRegistration() {
  const { api, isReady } = useVisualization();

  useEffect(() => {
    if (isReady && api) {
      // Register vgplot renderer for standard chart types
      // This is idempotent - won't cause re-renders if types already registered
      registerRenderer(createVgplotRenderer(api));
    }
  }, [api, isReady]);

  return null;
}

// ============================================================================
// Provider Wrapper
// ============================================================================

interface VisualizationSetupProps {
  children: ReactNode;
}

/**
 * VisualizationSetup - Wires up the visualization system.
 *
 * This component:
 * 1. Triggers DuckDB initialization on mount (lazy loading)
 * 2. Wraps children with VisualizationProvider once DuckDB is ready
 * 3. Registers the vgplot renderer on mount
 *
 * ## Provider Hierarchy
 *
 * ```
 * LazyDuckDBProvider (provides lazy db)
 *     └── VisualizationSetup (this component - triggers DuckDB init)
 *           └── VisualizationProvider (creates Mosaic coordinator)
 *                 └── RendererRegistration (registers vgplot)
 *                 └── children
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * // In layout.tsx
 * <LazyDuckDBProvider>
 *   <VisualizationSetup>
 *     <App />
 *   </VisualizationSetup>
 * </LazyDuckDBProvider>
 * ```
 *
 * ## Note
 *
 * This component triggers DuckDB initialization on mount via useLazyDuckDB.
 * Children are rendered immediately (pass-through during loading).
 * LazyDuckDBProvider handles error UI if initialization fails.
 * VisualizationProvider is only rendered after DuckDB is ready.
 */
export function VisualizationSetup({ children }: VisualizationSetupProps) {
  const { db, isInitialized, isLoading, error } = useLazyDuckDB();

  // Wait for DuckDB to initialize
  // Pass through children during loading - LazyDuckDBProvider handles error UI
  if (isLoading || !isInitialized || !db) {
    return <>{children}</>;
  }

  if (error) {
    return <>{children}</>; // Pass through - LazyDuckDBProvider handles errors
  }

  return (
    <VisualizationProvider db={db}>
      <RendererRegistration />
      {children}
    </VisualizationProvider>
  );
}

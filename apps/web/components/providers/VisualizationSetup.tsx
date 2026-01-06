"use client";

import {
  VisualizationProvider,
  createVgplotRenderer,
  registerRenderer,
  useVisualization,
} from "@dashframe/visualization";
import { useEffect, type ReactNode } from "react";
import { useDuckDB } from "./DuckDBProvider";

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
 * 1. Gets the DuckDB instance from DuckDBProvider
 * 2. Wraps children with VisualizationProvider
 * 3. Registers the vgplot renderer on mount
 *
 * ## Provider Hierarchy
 *
 * ```
 * DuckDBProvider (provides db)
 *     └── VisualizationSetup (this component)
 *           └── VisualizationProvider (creates Mosaic coordinator)
 *                 └── RendererRegistration (registers vgplot)
 *                 └── children
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * // In layout.tsx
 * <DuckDBProvider>
 *   <VisualizationSetup>
 *     <App />
 *   </VisualizationSetup>
 * </DuckDBProvider>
 * ```
 *
 * ## Note
 *
 * This component waits for DuckDB to initialize before rendering
 * the VisualizationProvider. Children will see a loading state
 * until both DuckDB and Mosaic are ready.
 */
export function VisualizationSetup({ children }: VisualizationSetupProps) {
  const { db, connection, isInitialized, error } = useDuckDB();

  // Wait for DuckDB to initialize
  if (!isInitialized || !db || !connection) {
    return <>{children}</>; // Pass through - DuckDBProvider handles loading
  }

  if (error) {
    return <>{children}</>; // Pass through - DuckDBProvider handles errors
  }

  return (
    <VisualizationProvider db={db} connection={connection}>
      <RendererRegistration />
      {children}
    </VisualizationProvider>
  );
}

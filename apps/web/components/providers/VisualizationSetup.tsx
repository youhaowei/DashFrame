"use client";

import { useEffect, type ReactNode } from "react";
import {
  VisualizationProvider,
  useVisualization,
  registerRenderer,
  createVgplotRenderer,
} from "@dashframe/visualization";
import { useDuckDB } from "./DuckDBProvider";

// ============================================================================
// Renderer Registration
// ============================================================================

/**
 * Registers chart renderers when the visualization system is ready.
 * This component runs once on mount and sets up the vgplot renderer.
 *
 * NOTE: Including createVgplotRenderer in deps ensures hot reload works
 * when making changes to the renderer implementation.
 */
function RendererRegistration() {
  const { api, isReady } = useVisualization();

  useEffect(() => {
    if (isReady && api) {
      // Register vgplot renderer for standard chart types
      registerRenderer(createVgplotRenderer(api));
      console.log("[VisualizationSetup] Registered vgplot renderer");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, isReady, createVgplotRenderer]);

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
  const { db, isInitialized, error } = useDuckDB();

  // Wait for DuckDB to initialize
  if (!isInitialized || !db) {
    return <>{children}</>; // Pass through - DuckDBProvider handles loading
  }

  if (error) {
    return <>{children}</>; // Pass through - DuckDBProvider handles errors
  }

  return (
    <VisualizationProvider db={db}>
      <RendererRegistration />
      {children}
    </VisualizationProvider>
  );
}

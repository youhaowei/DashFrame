"use client";

import { createContext, useContext, type ReactNode } from "react";

// ============================================================================
// Context Types
// ============================================================================

interface VisualizationContextValue {
  /** Whether the visualization system is ready */
  isReady: boolean;
  /** Initialization error, if any */
  error: Error | null;
}

const VisualizationContext = createContext<VisualizationContextValue>({
  isReady: false,
  error: null,
});

// ============================================================================
// Provider Props
// ============================================================================

export interface VisualizationProviderProps {
  /** Children to render */
  children: ReactNode;
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * VisualizationProvider - Signals that the visualization system is ready.
 *
 * With the Vega-Lite renderer, no Mosaic coordinator or vgplot API is needed.
 * This provider is a thin shell that signals readiness to consumers.
 * Data fetching is handled by useChartData at the consumer level.
 */
export function VisualizationProvider({
  children,
}: VisualizationProviderProps) {
  return (
    <VisualizationContext.Provider value={{ isReady: true, error: null }}>
      {children}
    </VisualizationContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to check if the visualization system is ready.
 */
export function useVisualization() {
  return useContext(VisualizationContext);
}

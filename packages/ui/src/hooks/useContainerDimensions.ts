"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

// ============================================================================
// Types
// ============================================================================

export interface ContainerDimensions {
  /** Container width in pixels */
  width: number;
  /** Container height in pixels */
  height: number;
  /** Whether valid dimensions have been measured */
  isReady: boolean;
}

export interface UseContainerDimensionsOptions {
  /**
   * Minimum width/height before considering dimensions "ready"
   * @default 1
   */
  minSize?: number;

  /**
   * Debounce delay in milliseconds for resize events
   * @default 0 (no debounce)
   */
  debounce?: number;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useContainerDimensions - Track container dimensions with ResizeObserver
 *
 * This hook measures a container's dimensions and returns them along with
 * an `isReady` flag that indicates when the container has valid (non-zero)
 * dimensions. Useful for components that need to wait for layout to complete
 * before rendering content.
 *
 * ## Features
 *
 * - Uses ResizeObserver for efficient dimension tracking
 * - SSR-safe (returns not-ready state on server)
 * - Optional debounce for rapid resize events
 * - Configurable minimum dimensions
 *
 * ## Usage
 *
 * ```tsx
 * function ResponsiveChart() {
 *   const { ref, width, height, isReady } = useContainerDimensions();
 *
 *   return (
 *     <div ref={ref} className="h-full w-full">
 *       {isReady ? (
 *         <Chart width={width} height={height} />
 *       ) : (
 *         <Loading />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 *
 * ## With Options
 *
 * ```tsx
 * const { ref, width, height, isReady } = useContainerDimensions({
 *   minSize: 10,      // Require at least 10x10px
 *   debounce: 150,    // Debounce resize by 150ms
 * });
 * ```
 *
 * @param options - Configuration options
 * @returns Object with ref, width, height, and isReady flag
 */
export function useContainerDimensions(
  options: UseContainerDimensionsOptions = {},
): ContainerDimensions & { ref: React.RefObject<HTMLDivElement | null> } {
  const { minSize = 1, debounce = 0 } = options;

  const ref = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<ContainerDimensions>({
    width: 0,
    height: 0,
    isReady: false,
  });

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the currently observed element to detect changes
  const observedElementRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // SSR guard
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined")
      return;

    const updateDimensions = (entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;

      // Check if dimensions meet minimum requirements
      const isReady = width >= minSize && height >= minSize;

      const newDimensions = {
        width: Math.round(width),
        height: Math.round(height),
        isReady,
      };

      if (debounce > 0) {
        // Clear existing timer
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        // Set new timer
        debounceTimerRef.current = setTimeout(() => {
          setDimensions(newDimensions);
          debounceTimerRef.current = null;
        }, debounce);
      } else {
        // No debounce - update immediately
        setDimensions(newDimensions);
      }
    };

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(element);
    observedElementRef.current = element;

    // Trigger initial measurement
    // This ensures we get dimensions even if the element doesn't resize
    const rect = element.getBoundingClientRect();
    const isReady = rect.width >= minSize && rect.height >= minSize;
    setDimensions({
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      isReady,
    });

    return () => {
      observer.disconnect();
      observedElementRef.current = null;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [minSize, debounce]);

  return useMemo(
    () => ({
      ref,
      ...dimensions,
    }),
    [dimensions],
  );
}

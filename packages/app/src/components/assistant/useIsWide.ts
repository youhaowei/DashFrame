import { useEffect, useState } from "react";

/**
 * Tracks whether the viewport is at least Tailwind's `lg` breakpoint (1024px).
 * Used so the assistant region mounts exactly one panel presentation (docked
 * rail vs. overlay) instead of rendering both and hiding one with CSS — which
 * would double-mount the panel and its context consumers.
 *
 * SSR-safe: assumes wide on the server / first paint, then corrects after mount.
 */
export function useIsWide(minWidthPx = 1024): boolean {
  const [isWide, setIsWide] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(min-width: ${minWidthPx}px)`);
    const update = () => setIsWide(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [minWidthPx]);

  return isWide;
}

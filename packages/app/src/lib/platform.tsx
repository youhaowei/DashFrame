import { createContext, useContext, useEffect, useMemo } from "react";

/**
 * Host-environment facts the shell chrome needs. This is the one sanctioned
 * place where "am I in Electron / on macOS" is allowed to matter (DESIGN.md
 * bans per-surface UI forks for *capability*, not for window chrome — the
 * traffic-light spacer and drag region are a genuine host difference, mirrored
 * from workforce's PlatformProvider).
 */
export interface Platform {
  /** Running inside the Electron renderer (vs. the web host). */
  isElectron: boolean;
  /** macOS — where the traffic lights live top-left and need a spacer. */
  isMacOS: boolean;
  /** Windows, where caption controls overlay the top-right of the app. */
  isWindows: boolean;
}

const PlatformContext = createContext<Platform | null>(null);

function detectPlatform(): Platform {
  if (typeof window === "undefined") {
    return { isElectron: false, isMacOS: false, isWindows: false };
  }
  // The preload bridge exposes `window.dashframe`; its presence is the Electron
  // signal (web host never defines it).
  const isElectron = "dashframe" in window;
  const platform =
    // `navigator.userAgentData` is the modern source; fall back to platform.
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    "";
  const isMacOS = /mac/i.test(platform);
  const isWindows = /win/i.test(platform);
  return { isElectron, isMacOS, isWindows };
}

/**
 * Mirrors the host facts onto `<html>` as data attributes so the raw drag-region
 * CSS (which must live outside Lightning CSS, in index.html) can gate on them:
 * `html[data-electron]:not([data-fullscreen]) .titlebar-drag-region`.
 */
export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const platform = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    const root = document.documentElement;
    if (platform.isElectron) root.setAttribute("data-electron", "");
    else root.removeAttribute("data-electron");
    if (platform.isMacOS) root.setAttribute("data-macos", "");
    else root.removeAttribute("data-macos");
    if (platform.isWindows) root.setAttribute("data-windows", "");
    else root.removeAttribute("data-windows");
  }, [platform]);

  return <PlatformContext value={platform}>{children}</PlatformContext>;
}

export function usePlatform(): Platform {
  const ctx = useContext(PlatformContext);
  if (!ctx)
    throw new Error("usePlatform must be used within a PlatformProvider");
  return ctx;
}

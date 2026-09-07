import { useEffect, useMemo } from "react";

export type HighlightKind = "widget" | "insight";

function clearHighlights(doc: Document): void {
  for (const element of doc.querySelectorAll("[data-webmcp-highlight]"))
    element.removeAttribute("data-webmcp-highlight");
}

function findHighlightTarget(
  doc: Document,
  kind: HighlightKind,
  id: string,
): HTMLElement | null {
  const attribute =
    kind === "widget"
      ? "data-dashframe-widget-id"
      : "data-dashframe-insight-id";
  return (
    Array.from(doc.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
      (element) => element.getAttribute(attribute) === id,
    ) ?? null
  );
}

export interface WebMCPHighlightController {
  highlight(kind: HighlightKind, id: string): number;
  dispose(): void;
}

export function createWebMCPHighlightController(
  doc: Document,
): WebMCPHighlightController {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    highlight(kind, id) {
      const target = findHighlightTarget(doc, kind, id);
      if (!target)
        throw new Error("The requested item is not visible on screen.");
      if (timer) clearTimeout(timer);
      clearHighlights(doc);
      target.setAttribute("data-webmcp-highlight", "true");
      const reduceMotion =
        typeof globalThis.matchMedia === "function" &&
        globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
      timer = setTimeout(() => {
        target.removeAttribute("data-webmcp-highlight");
        timer = undefined;
      }, 4_000);
      return 4_000;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      clearHighlights(doc);
    },
  };
}

/** One controller survives tool rebuilds and is disposed with the provider. */
export function useWebMCPHighlightController(
  doc: Document,
): WebMCPHighlightController {
  const controller = useMemo(() => createWebMCPHighlightController(doc), [doc]);
  useEffect(() => () => controller.dispose(), [controller]);
  return controller;
}

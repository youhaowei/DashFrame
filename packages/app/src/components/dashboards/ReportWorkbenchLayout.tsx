/**
 * The report editor's workbench: the same three-pane shell as the insight
 * workbench. Report settings on the left, the canvas with its compact header
 * in the middle, the selected item's configuration on the right.
 */

import { AppLayout } from "@/components/layouts/AppLayout";
import { cn } from "@wystack/ui-react";
import type { MouseEvent, ReactNode } from "react";

const PANE_CLASS =
  // Shrinkable, so on a narrow window the panes give way before the canvas
  // does: its header holds the only controls that collapse them.
  "h-full min-w-0 overflow-hidden transition-[width] duration-200 motion-reduce:transition-none";

export function ReportWorkbenchLayout({
  header,
  leftPane,
  leftOpen,
  setLeftPane,
  rightPane,
  rightOpen,
  setRightPane,
  children,
}: {
  header: ReactNode;
  leftPane: ReactNode;
  leftOpen: boolean;
  setLeftPane: (element: HTMLElement | null) => void;
  rightPane: ReactNode;
  rightOpen: boolean;
  setRightPane: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <AppLayout pageHeader={null} childrenClassName="overflow-hidden">
      <div className="flex h-full min-w-0 overflow-hidden">
        <aside
          ref={setLeftPane}
          aria-label="Report"
          inert={!leftOpen}
          aria-hidden={!leftOpen}
          className={cn(PANE_CLASS, leftOpen ? "w-64" : "w-0")}
        >
          <div className="h-full w-64">{leftPane}</div>
        </aside>

        <section className="flex min-w-[min(18rem,100%)] flex-1 flex-col gap-2 overflow-hidden px-1.5 py-2">
          {header}
          {children}
        </section>

        <aside
          ref={setRightPane}
          aria-label="Report item"
          inert={!rightOpen}
          aria-hidden={!rightOpen}
          className={cn(PANE_CLASS, rightOpen ? "w-60" : "w-0")}
        >
          <div className="h-full w-60 min-w-0">{rightPane}</div>
        </aside>
      </div>
    </AppLayout>
  );
}

/**
 * Collapses by its own width: status and width readout below 64rem, action
 * labels below 48rem, breadcrumb and frame controls below 42rem. Under that it
 * scrolls rather than clip.
 */
export function ReportWorkbenchHeader({ children }: { children: ReactNode }) {
  return (
    <header className="@container flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto px-1 whitespace-nowrap [scrollbar-width:thin] [&>*]:shrink-0">
      {children}
    </header>
  );
}

/**
 * Sunken well the report page sits in. The view page uses it too, so both lay
 * the report out at the same width.
 */
export function ReportCanvasWell({
  setCanvas,
  onBackgroundClick,
  children,
}: {
  setCanvas: (element: HTMLElement | null) => void;
  /** A click outside every report item. */
  onBackgroundClick?: () => void;
  children: ReactNode;
}) {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target as HTMLElement).closest("[data-dashframe-widget-id]")) {
      onBackgroundClick?.();
    }
  };
  return (
    <div
      ref={setCanvas}
      className="min-h-0 flex-1 overflow-auto rounded-[var(--surface-radius)] bg-neutral-bg-muted p-6 shadow-inner dark:bg-neutral-bg-dim"
      onClick={handleClick}
    >
      {children}
    </div>
  );
}

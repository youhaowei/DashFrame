import type { ReactNode } from "react";
import { cn } from "@dashframe/ui";

export interface WorkbenchLayoutProps {
  /** Sticky header section */
  header: ReactNode;
  /** Left sidebar panel (e.g., controls, configuration) */
  leftPanel?: ReactNode;
  /** Optional right sidebar panel */
  rightPanel?: ReactNode;
  /** Optional footer content */
  footer?: ReactNode;
  /** Main content area */
  children: ReactNode;
  /** Optional className for the container */
  className?: string;
  /** Optional className for the children wrapper (main content area) */
  childrenClassName?: string;
}

/**
 * WorkbenchLayout - Reusable layout for workbench-style pages
 *
 * Provides a consistent structure with:
 * - Sticky top header
 * - Left/Right attached sidebars
 * - Main content area with scrolling
 * - Optional footer
 *
 * @example
 * ```tsx
 * <WorkbenchLayout
 *   header={<MyHeader />}
 *   leftPanel={<Controls />}
 * >
 *   <Content />
 * </WorkbenchLayout>
 * ```
 */
export function WorkbenchLayout({
  header,
  leftPanel,
  rightPanel,
  footer,
  children,
  className,
  childrenClassName,
}: WorkbenchLayoutProps) {
  return (
    <div
      className={cn(
        "flex h-screen flex-col overflow-hidden bg-background",
        className,
      )}
    >
      {/* Sticky Header */}
      <header className="bg-card/90 sticky top-0 z-10 shrink-0 border-b backdrop-blur-sm">
        {header}
      </header>

      {/* Main Layout Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left panel */}
        {leftPanel && (
          <aside className="bg-card flex h-full w-72 shrink-0 flex-col overflow-y-auto border-r">
            {leftPanel}
          </aside>
        )}

        {/* Main content */}
        <main className="bg-background flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className={cn(
              "flex-1 overflow-y-auto p-0",
              childrenClassName,
            )}
          >
            {children}
          </div>
        </main>

        {/* Right panel (optional) */}
        {rightPanel && (
          <aside className="bg-card flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-l">
            {rightPanel}
          </aside>
        )}
      </div>

      {/* Footer (optional) */}
      {footer && (
        <footer className="bg-card/90 sticky bottom-0 shrink-0 border-t backdrop-blur-sm px-6 py-4">
          {footer}
        </footer>
      )}
    </div>
  );
}

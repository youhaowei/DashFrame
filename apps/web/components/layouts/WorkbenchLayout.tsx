import type { ReactNode } from "react";
import { CollapsibleSection } from "@/components/shared/CollapsibleSection";
import { cn } from "@/lib/utils";

export interface WorkbenchLayoutProps {
  /** Top selector section - will be wrapped in CollapsibleSection automatically */
  selector: ReactNode;
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
}

/**
 * WorkbenchLayout - Reusable layout for workbench-style pages
 *
 * Provides a consistent structure with:
 * - Collapsible top selector (e.g., ItemSelector for visualizations/data sources)
 * - Left sidebar panel (e.g., controls, configuration)
 * - Main content area
 * - Optional right panel and footer for future use
 *
 * @example
 * ```tsx
 * <WorkbenchLayout
 *   selector={
 *     <ItemSelector
 *       title="Visualizations"
 *       items={items}
 *       onItemSelect={setActive}
 *       actions={actions}
 *     />
 *   }
 *   leftPanel={<VisualizationControls />}
 * >
 *   <VisualizationDisplay />
 * </WorkbenchLayout>
 * ```
 */
export function WorkbenchLayout({
  selector,
  leftPanel,
  rightPanel,
  footer,
  children,
  className,
}: WorkbenchLayoutProps) {
  return (
    <div className={cn("flex h-screen flex-col gap-4 overflow-hidden", className)}>
      {/* Top collapsible selector */}
      <div className="shrink-0">
        <CollapsibleSection>
          <div className="mt-4">
            {selector}
          </div>
        </CollapsibleSection>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Left panel */}
        {leftPanel && (
          <aside className="w-[360px] shrink-0 h-full">
            {leftPanel}
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 h-full">
          {children}
        </main>

        {/* Right panel (optional) */}
        {rightPanel && (
          <aside className="w-[360px] shrink-0 h-full">
            {rightPanel}
          </aside>
        )}
      </div>

      {/* Footer (optional) */}
      {footer && (
        <footer className="shrink-0">
          {footer}
        </footer>
      )}
    </div>
  );
}

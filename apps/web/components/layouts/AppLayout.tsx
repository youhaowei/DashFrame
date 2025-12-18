import type { ReactNode } from "react";
import Link from "next/link";
import { cn, Breadcrumb, type BreadcrumbItem } from "@dashframe/ui";

export interface AppLayoutProps {
  /** Breadcrumb navigation items */
  breadcrumbs?: BreadcrumbItem[];
  /** Optional header content (shown after breadcrumbs) */
  headerContent?: ReactNode;
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
 * AppLayout - Reusable layout for application pages
 *
 * Provides a consistent structure with:
 * - Sticky top header with breadcrumb navigation
 * - Optional additional header content
 * - Left/Right attached sidebars
 * - Main content area with scrolling
 * - Optional footer
 *
 * @example
 * ```tsx
 * <AppLayout
 *   breadcrumbs={[
 *     { label: "Insights", href: "/insights" },
 *     { label: "My Insight" },
 *   ]}
 *   leftPanel={<Controls />}
 * >
 *   <Content />
 * </AppLayout>
 * ```
 */
export function AppLayout({
  breadcrumbs,
  headerContent,
  leftPanel,
  rightPanel,
  footer,
  children,
  className,
  childrenClassName,
}: AppLayoutProps) {
  return (
    <div
      className={cn(
        "bg-background flex h-screen flex-col overflow-hidden",
        className,
      )}
    >
      {/* Sticky Header */}
      <header className="bg-card/90 sticky top-0 z-10 shrink-0 border-b backdrop-blur-sm">
        <div className="container mx-auto px-8 py-4">
          <div className="flex items-center justify-between gap-6">
            {/* Breadcrumb navigation */}
            {breadcrumbs && breadcrumbs.length > 0 && (
              <Breadcrumb LinkComponent={Link} items={breadcrumbs} />
            )}

            {/* Additional header content */}
            {headerContent && <div className="flex-1">{headerContent}</div>}
          </div>
        </div>
      </header>

      {/* Main Layout Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left panel */}
        {leftPanel && (
          <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto p-2">
            {leftPanel}
          </aside>
        )}

        {/* Main content */}
        <main className="bg-background flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <div className={cn("flex-1 overflow-y-auto p-0", childrenClassName)}>
            {children}
          </div>
        </main>

        {/* Right panel (optional) */}
        {rightPanel && (
          <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-y-auto">
            {rightPanel}
          </aside>
        )}
      </div>

      {/* Footer (optional) */}
      {footer && (
        <footer className="bg-card/90 sticky bottom-0 shrink-0 border-t px-6 py-4 backdrop-blur-sm">
          {footer}
        </footer>
      )}
    </div>
  );
}

/**
 * @deprecated Use AppLayout instead. This is a backward-compatible alias.
 */
export interface WorkbenchLayoutProps
  extends Omit<AppLayoutProps, "breadcrumbs" | "headerContent"> {
  /** @deprecated Use breadcrumbs instead */
  header?: ReactNode;
}

/**
 * @deprecated Use AppLayout instead. WorkbenchLayout is kept for backward compatibility.
 */
export function WorkbenchLayout({ header, ...props }: WorkbenchLayoutProps) {
  return <AppLayout headerContent={header} {...props} />;
}

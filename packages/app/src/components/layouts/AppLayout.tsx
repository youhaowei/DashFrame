import { useRenderPerf } from "@/lib/perf";
import { cn } from "@wystack/ui-react";
import type { ReactNode } from "react";

type AppLayoutBaseProps = {
  /** Left sidebar panel (e.g., controls, configuration) */
  leftPanel?: ReactNode;
  /** Optional footer content */
  footer?: ReactNode;
  /** Main content area */
  children: ReactNode;
  /** Optional className for the container */
  className?: string;
  /** Optional className for the children wrapper (main content area) */
  childrenClassName?: string;
};

type AppLayoutHeaderProps =
  | {
      /** Complete header override; pass `null` to render no header. Cannot be combined with headerContent. */
      pageHeader: ReactNode;
      headerContent?: never;
    }
  | {
      pageHeader?: undefined;
      /** Optional content for a sticky page header. Without it, no header renders. */
      headerContent?: ReactNode;
    };

export type AppLayoutProps = AppLayoutBaseProps & AppLayoutHeaderProps;

/**
 * AppLayout - Reusable layout for application pages
 *
 * Provides a consistent structure with:
 * - An optional sticky page header (`headerContent` or `pageHeader`)
 * - Optional left attached sidebar
 * - Main content area with scrolling
 * - Optional footer
 *
 * Breadcrumbs are not part of the page: pages register them with
 * `useAppBreadcrumbs` and the app bar renders them.
 *
 * @example
 * ```tsx
 * <AppLayout
 *   headerContent={<Toolbar />}
 *   leftPanel={<Controls />}
 * >
 *   <Content />
 * </AppLayout>
 * ```
 */
export function AppLayout({
  pageHeader,
  headerContent,
  leftPanel,
  footer,
  children,
  className,
  childrenClassName,
}: AppLayoutProps) {
  // Render boundary for the shared layout: every page built on AppLayout feeds
  // the perf HUD a time-to-paint sample; the Shell's `shell:${pathname}`
  // sample tells pages apart.
  useRenderPerf("layout:page");

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden bg-neutral-bg",
        className,
      )}
    >
      {/* Sticky Header */}
      {/* An explicit `pageHeader` wins; otherwise a header only holds `headerContent`. */}
      {pageHeader !== undefined
        ? pageHeader
        : headerContent && (
            <header className="sticky top-0 z-10 shrink-0 border-b bg-neutral-bg/90 backdrop-blur-sm">
              <div className="container mx-auto px-8 py-4">{headerContent}</div>
            </header>
          )}

      {/* Main Layout Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left panel */}
        {leftPanel && (
          <aside className="flex h-full w-80 shrink-0 flex-col overflow-x-hidden overflow-y-auto p-2">
            {leftPanel}
          </aside>
        )}

        {/* Main content */}
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-neutral-bg">
          <div className={cn("flex-1 overflow-y-auto p-0", childrenClassName)}>
            {children}
          </div>
        </main>
      </div>

      {/* Footer (optional) */}
      {footer && (
        <footer className="sticky bottom-0 shrink-0 border-t bg-neutral-bg/90 px-6 py-4 backdrop-blur-sm">
          {footer}
        </footer>
      )}
    </div>
  );
}

/**
 * @deprecated Use AppLayout instead. This is a backward-compatible alias.
 */
export type WorkbenchLayoutProps = AppLayoutBaseProps & {
  /** @deprecated Use headerContent instead */
  header?: ReactNode;
};

/**
 * @deprecated Use AppLayout instead. WorkbenchLayout is kept for backward compatibility.
 */
export function WorkbenchLayout({ header, ...props }: WorkbenchLayoutProps) {
  return <AppLayout headerContent={header} {...props} />;
}

import type { ReactNode, Ref } from "react";

/** Shared page identity and actions; artifact-specific tools occupy the second row. */
export function ArtifactPageHeader({
  title,
  titleIcon,
  titleRef,
  description,
  navigation,
  actions,
  children,
}: {
  title: ReactNode;
  titleIcon?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  description?: ReactNode;
  navigation?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-neutral-border bg-neutral-bg px-4 py-4 sm:px-6">
      {navigation && <div className="mb-3 min-w-0">{navigation}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex min-w-0 items-center gap-3">
            {titleIcon && (
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center"
              >
                {titleIcon}
              </span>
            )}
            <h1
              ref={titleRef}
              tabIndex={titleRef ? -1 : undefined}
              className="min-w-0 break-words text-xl font-semibold text-neutral-fg"
            >
              {title}
            </h1>
          </div>
          {description && (
            <div className="mt-1 text-sm text-neutral-fg-subtle">
              {description}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children && (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3">
          {children}
        </div>
      )}
    </header>
  );
}

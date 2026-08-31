import { Link } from "@tanstack/react-router";
import { Input } from "@wystack/ui-react";
import { SearchIcon } from "@wystack/ui-react/icons";
import type { ReactNode } from "react";

import { ArtifactPageHeader } from "./ArtifactPageHeader";

export type ArtifactCollectionProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  navigation?: ReactNode;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchPlaceholder: string;
  searchLabel: string;
  children: ReactNode;
  tools?: ReactNode;
};

/** Shared shell for artifact index pages. */
export function ArtifactCollection({
  title,
  description,
  actions,
  navigation,
  searchQuery,
  onSearchQueryChange,
  searchPlaceholder,
  searchLabel,
  children,
  tools,
}: ArtifactCollectionProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-bg">
      <ArtifactPageHeader
        title={title}
        description={description}
        actions={actions}
        navigation={navigation}
      >
        <div className="relative w-full max-w-sm">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-fg-subtle"
          />
          <Input
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="pl-9"
          />
        </div>
        {tools}
      </ArtifactPageHeader>
      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}

export function ArtifactGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
      {children}
    </div>
  );
}

export function ArtifactEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      {description && (
        <p className="mb-4 text-sm text-neutral-fg-subtle">{description}</p>
      )}
      {action}
    </div>
  );
}

export type ArtifactCardProps = {
  to?: string;
  name: ReactNode;
  metadata?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/** Shared content card; menus and confirmation controls stay outside navigation. */
export function ArtifactCard({
  to,
  name,
  metadata,
  icon,
  actions,
  footer,
  className,
}: ArtifactCardProps) {
  const content = (
    <>
      {icon && (
        <span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center text-neutral-fg-subtle"
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block break-words font-medium text-neutral-fg">
          {name}
        </span>
        {metadata && (
          <span className="mt-2 block break-words text-xs text-neutral-fg-subtle">
            {metadata}
          </span>
        )}
      </span>
    </>
  );
  const contentClassName =
    "flex min-h-30 min-w-0 flex-1 items-start gap-3 rounded-lg p-4 pr-14";

  return (
    <article
      className={`group relative flex min-w-0 flex-col rounded-lg border border-neutral-border/60 bg-neutral-bg transition-colors hover:bg-neutral-bg-subtle ${className ?? ""}`}
    >
      {to ? (
        <Link
          to={to as never}
          className={`${contentClassName} outline-none focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-bg`}
        >
          {content}
        </Link>
      ) : (
        <div className={contentClassName}>{content}</div>
      )}
      {actions && <div className="absolute top-3 right-3">{actions}</div>}
      {footer && (
        <div className="border-t border-neutral-border p-3">{footer}</div>
      )}
    </article>
  );
}

import { groupHoverAndFocusWithinReveal } from "@dashframe/ui";
import { Link } from "@tanstack/react-router";
import { Input, Toggle } from "@wystack/ui-react";
import {
  ChevronDownIcon,
  GridIcon,
  ListIcon,
  SearchIcon,
} from "@wystack/ui-react/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { CollectionView } from "@/lib/stores/shell-store";

import type { CollectionGroup } from "./collection-groups";

export type ArtifactCollectionProps = {
  title: ReactNode;
  /** Shown muted beside the title; omit while unknown. */
  count?: number;
  actions?: ReactNode;
  /** Undefined while the collection query is pending. */
  itemCount: number | undefined;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchPlaceholder: string;
  searchLabel: string;
  children: ReactNode;
  tools?: ReactNode;
  /** Grid or list; the toggle shows only when both are given. */
  view?: CollectionView;
  onViewChange?: (view: CollectionView) => void;
};

const VIEW_OPTIONS = [
  {
    value: "grid" as const,
    icon: <GridIcon aria-hidden className="h-4 w-4" />,
    ariaLabel: "Grid view",
    tooltip: "Grid view",
  },
  {
    value: "list" as const,
    icon: <ListIcon aria-hidden className="h-4 w-4" />,
    ariaLabel: "List view",
    tooltip: "List view",
  },
];

/**
 * Shared shell for artifact index pages: one header line (title, count,
 * search, view toggle, primary action) over a faintly tinted well that the
 * tiles lift off.
 */
export function ArtifactCollection({
  title,
  count,
  actions,
  itemCount,
  searchQuery,
  onSearchQueryChange,
  searchPlaceholder,
  searchLabel,
  children,
  tools,
  view,
  onViewChange,
}: ArtifactCollectionProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previousSearchQueryRef = useRef(searchQuery);
  const hasItemsOrQuery =
    itemCount === undefined || itemCount > 0 || searchQuery.length > 0;
  const showViewToggle =
    view !== undefined && onViewChange !== undefined && !!itemCount;

  useEffect(() => {
    const searchWasCleared =
      previousSearchQueryRef.current.length > 0 && searchQuery.length === 0;
    previousSearchQueryRef.current = searchQuery;

    if (searchWasCleared) {
      if (itemCount === 0) {
        titleRef.current?.focus();
      } else {
        searchInputRef.current?.focus();
      }
    }
  }, [itemCount, searchQuery]);

  return (
    // Light: a faint tint under white tiles. Dark: the panel's own fill, with
    // tiles one step lighter, so hover lifts rather than sinks.
    <div className="flex h-full min-h-0 flex-col bg-neutral-bg-subtle dark:bg-neutral-bg">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <div className="flex min-w-0 flex-1 basis-32 items-baseline gap-2">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="min-w-0 break-words text-xl font-semibold text-neutral-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-ring"
          >
            {title}
          </h1>
          {count !== undefined && (
            <span className="text-sm tabular-nums text-neutral-fg-subtle">
              {count}
              <span className="sr-only"> total</span>
            </span>
          )}
        </div>
        {hasItemsOrQuery && (
          <div className="relative order-last w-full sm:order-none sm:w-60">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-neutral-fg-subtle"
            />
            <Input
              ref={searchInputRef}
              size="sm"
              aria-label={searchLabel}
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              // A sunken well: sub tone, inset shadow, hairline ring.
              className="border-0 bg-neutral-bg-subtle pl-8 shadow-inner ring-[0.5px] ring-neutral-border"
            />
          </div>
        )}
        {tools}
        {showViewToggle && (
          <Toggle
            size="sm"
            value={view}
            onValueChange={onViewChange}
            options={VIEW_OPTIONS}
          />
        )}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto px-4 pt-1 pb-6 sm:px-6">
        {children}
      </div>
    </div>
  );
}

export function ArtifactGrid({
  children,
  compact = false,
}: {
  children: ReactNode;
  /** Compact tiles fit about four across a desktop panel. */
  compact?: boolean;
}) {
  return (
    <div
      className={`grid w-full gap-3 ${
        compact
          ? "grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))]"
          : "grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))]"
      }`}
    >
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
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {description && (
        <p className="mb-4 text-sm text-neutral-fg-subtle">{description}</p>
      )}
      {action}
    </div>
  );
}

export type ArtifactCardProps = {
  to?: string;
  search?: Record<string, string | undefined>;
  name: ReactNode;
  headingLevel?: 2 | 3;
  metadata?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/** Shared content card; menus and confirmation controls stay outside navigation. */
export function ArtifactCard({
  to,
  search,
  name,
  headingLevel = 2,
  metadata,
  icon,
  actions,
  footer,
  className,
}: ArtifactCardProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
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
      <div className="min-w-0 flex-1">
        <Heading className="block break-words font-medium text-neutral-fg">
          {name}
        </Heading>
        {metadata && (
          <span className="mt-2 block break-words text-xs text-neutral-fg-subtle">
            {metadata}
          </span>
        )}
      </div>
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
          search={search as never}
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

/**
 * Actions that appear on hover or focus. With a hovering pointer they take no
 * pointer events until revealed, so an invisible button never catches a click
 * meant for the link beneath. Touch screens never hover: there they stay
 * visible (muted) and tappable.
 */
const revealedActions =
  "pointer-events-none group-focus-within:pointer-events-auto [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:**:opacity-70";

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-bg";

export type ArtifactTileProps = {
  to: string;
  name: ReactNode;
  /** Recognition mark: a report's layout miniature or a provider mark. */
  glyph: ReactNode;
  /** One muted line; every fact on it should answer a question. */
  meta?: ReactNode;
  headingLevel?: 2 | 3;
  actions?: ReactNode;
};

/** Compact grid tile: glyph, name, one meta line; lifts on hover. */
export function ArtifactTile({
  to,
  name,
  glyph,
  meta,
  headingLevel = 2,
  actions,
}: ArtifactTileProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <article className="group relative flex min-w-0 rounded-[var(--surface-radius)] bg-neutral-bg shadow-[var(--shadow-sm)] transition-shadow duration-150 hover:shadow-[var(--shadow-lg)] focus-within:shadow-[var(--shadow-lg)] motion-reduce:transition-none dark:bg-neutral-bg-subtle">
      <Link
        to={to as never}
        className={`flex min-w-0 flex-1 flex-col rounded-[var(--surface-radius)] p-4 ${focusRing}`}
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-12 items-start text-neutral-fg-subtle"
        >
          {glyph}
        </span>
        <Heading className="mt-7 truncate pr-6 font-medium text-neutral-fg">
          {name}
        </Heading>
        {meta && (
          <span className="mt-0.5 block text-xs text-neutral-fg-subtle">
            {meta}
          </span>
        )}
      </Link>
      {actions && (
        // Same touch rule as rows: hidden and untappable until a hovering
        // pointer or focus reveals it; where nothing hovers, muted but visible
        // and tappable, since the menu holds Delete.
        <div
          data-slot="tile-actions"
          className={`absolute top-2 right-2 ${revealedActions}`}
        >
          {actions}
        </div>
      )}
    </article>
  );
}

export type ArtifactRowProps = {
  to: string;
  name: ReactNode;
  glyph: ReactNode;
  /** Muted, inline after the name. */
  meta?: ReactNode;
  /** Right-aligned; hidden while the row's actions show. */
  time?: ReactNode;
  headingLevel?: 2 | 3;
  actions?: ReactNode;
};

/** One reading line: glyph, name, inline meta, time; hover reveals actions. */
export function ArtifactRow({
  to,
  name,
  glyph,
  meta,
  time,
  headingLevel = 2,
  actions,
}: ArtifactRowProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <li className="group relative flex h-9 min-w-0 items-center rounded-md transition-colors duration-150 hover:bg-neutral-bg-muted focus-within:bg-neutral-bg-muted motion-reduce:transition-none dark:hover:bg-neutral-bg-subtle dark:focus-within:bg-neutral-bg-subtle">
      <Link
        to={to as never}
        className={`flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-sm ${focusRing}`}
      >
        <span
          aria-hidden="true"
          className="flex h-4 w-5.5 shrink-0 items-center justify-center text-neutral-fg-subtle"
        >
          {glyph}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
          {/* Both truncate; the meta gives way first so the name stays read. */}
          <Heading className="min-w-0 truncate font-medium text-neutral-fg">
            {name}
          </Heading>
          {meta && (
            <span className="min-w-0 shrink-[4] truncate text-neutral-fg-subtle">
              {meta}
            </span>
          )}
        </span>
        {time && (
          <span className="shrink-0 pl-3 text-xs tabular-nums text-neutral-fg-subtle transition-opacity duration-150 group-focus-within:opacity-0 motion-reduce:transition-none [@media(hover:hover)]:group-hover:opacity-0 [@media(hover:none)]:mr-8">
            {time}
          </span>
        )}
      </Link>
      {actions && (
        // Invisible actions must not catch taps meant for the row: with a
        // hovering pointer they take pointer events only once revealed. Touch
        // screens never hover, so there the overflow menu (the page's only
        // Delete) stays visible, muted and tappable, while Open, which only
        // repeats a tap on the row, stays hidden.
        <div
          data-slot="row-actions"
          className={`absolute right-1.5 flex items-center gap-0.5 ${revealedActions}`}
        >
          {actions}
        </div>
      )}
    </li>
  );
}

/**
 * The hover "Open" on a row. The row itself is the link keyboard and screen
 * reader users reach, so this pointer shortcut stays out of the tab order.
 */
export function ArtifactRowOpen({ to }: { to: string }) {
  return (
    <Link
      to={to as never}
      tabIndex={-1}
      aria-hidden="true"
      className={`rounded-md px-2 py-1 text-xs font-medium text-neutral-fg-subtle transition-opacity duration-150 hover:bg-neutral-bg-emphasis hover:text-neutral-fg motion-reduce:transition-none [@media(hover:none)]:hidden ${groupHoverAndFocusWithinReveal}`}
    >
      Open
    </Link>
  );
}

/** Where a row sits: under a group label (heading level 3) or in a flat list. */
export type ArtifactRowPlacement = { grouped: boolean; headingLevel: 2 | 3 };

const FLAT: ArtifactRowPlacement = { grouped: false, headingLevel: 2 };
const GROUPED: ArtifactRowPlacement = { grouped: true, headingLevel: 3 };

/**
 * Rows under sticky, collapsible group labels. A single group renders as a
 * flat list: a label that every row shares tells the reader nothing.
 */
export function ArtifactRowGroups<T>({
  groups,
  renderRow,
}: {
  groups: readonly CollectionGroup<T>[];
  renderRow: (item: T, placement: ArtifactRowPlacement) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  if (groups.length < 2) {
    return (
      <ul className="flex flex-col">
        {groups.flatMap((group) =>
          group.items.map((item) => renderRow(item, FLAT)),
        )}
      </ul>
    );
  }

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((group) => {
        const open = !collapsed.has(group.key);
        const bodyId = `artifact-group-${group.key}`;
        return (
          <section key={group.key}>
            <h2 className="sticky top-0 z-10 bg-neutral-bg-subtle dark:bg-neutral-bg">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => toggle(group.key)}
                className={`flex h-7.5 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium text-neutral-fg-subtle transition-colors duration-150 hover:bg-neutral-bg-muted motion-reduce:transition-none dark:hover:bg-neutral-bg-subtle ${focusRing}`}
              >
                <ChevronDownIcon
                  aria-hidden
                  className={`h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
                />
                {group.label}
                <span className="font-normal tabular-nums">
                  {group.items.length}
                </span>
              </button>
            </h2>
            {/* Collapse animates the row track from 1fr to 0fr; inert keeps
                folded rows out of the tab order and the accessibility tree. */}
            <div
              id={bodyId}
              inert={!open}
              aria-hidden={!open}
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                open
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <ul className="flex min-h-0 flex-col overflow-hidden">
                {group.items.map((item) => renderRow(item, GROUPED))}
              </ul>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The app bar's breadcrumb. Pages declare where they sit with
 * `useAppBreadcrumbs`; the top bar renders the trail, so every page shows it in
 * the same place instead of drawing its own.
 */

import { Link } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  cn,
} from "@wystack/ui-react";
import { Fragment, useEffect, useState } from "react";
import { create } from "zustand";

export interface AppBreadcrumb {
  label: string;
  /** Omit for the current page. */
  to?: string;
}

interface RegisteredTrail {
  /** `null` while the page does not know its trail yet; it keeps its place meanwhile. */
  items: AppBreadcrumb[] | null;
  owner: symbol;
}

interface BreadcrumbStore {
  /** Every mounted page that uses the bar, in the order they mounted. */
  registered: RegisteredTrail[];
  register: (items: AppBreadcrumb[] | null, owner: symbol) => void;
  release: (owner: symbol) => void;
}

/**
 * Same rule as the top-bar tabs: the newest mounted page with a trail is
 * shown. Keeping older pages means one that unmounts first (an aborted
 * navigation, a Suspense retry) hands the bar back to the page still on
 * screen, and an outgoing page whose data resolves late cannot take it back
 * from the page that replaced it.
 */
export const useBreadcrumbStore = create<BreadcrumbStore>()((set) => ({
  registered: [],
  register: (items, owner) =>
    set((state) => {
      const index = state.registered.findIndex(
        (entry) => entry.owner === owner,
      );
      if (index === -1) {
        return { registered: [...state.registered, { items, owner }] };
      }
      const registered = [...state.registered];
      registered[index] = { items, owner };
      return { registered };
    }),
  release: (owner) =>
    set((state) => {
      const registered = state.registered.filter(
        (entry) => entry.owner !== owner,
      );
      return registered.length === state.registered.length
        ? state
        : { registered };
    }),
}));

function selectTrail(state: BreadcrumbStore): AppBreadcrumb[] | null {
  return state.registered.findLast((entry) => entry.items)?.items ?? null;
}

/**
 * Shows `items` in the app bar while the calling component is mounted. Pass
 * `null` until the page knows its trail (say, while its artifact loads).
 *
 * End the trail at the artifact. When the page also shows top-bar tabs, the
 * tabs stand in for the current page: the last item stops being the current
 * page and the tab strip follows it.
 *
 * @example
 * useAppBreadcrumbs([{ label: "Data Sources", to: "/data-sources" }, { label: name }]);
 */
export function useAppBreadcrumbs(items: readonly AppBreadcrumb[] | null) {
  const register = useBreadcrumbStore((state) => state.register);
  const release = useBreadcrumbStore((state) => state.release);
  // One identity for the component's lifetime, so an update replaces the
  // registration in place and the page keeps its place in mount order.
  const [owner] = useState(() => Symbol("app-breadcrumbs"));
  // Compared by content, so a fresh array literal each render doesn't re-set.
  const key = items ? JSON.stringify(items) : null;

  useEffect(() => {
    register(key === null ? null : (JSON.parse(key) as AppBreadcrumb[]), owner);
  }, [key, owner, register]);

  useEffect(() => () => release(owner), [owner, release]);
}

function CrumbLabel({
  item,
  isCurrent,
}: {
  item: AppBreadcrumb;
  isCurrent: boolean;
}) {
  if (item.to) {
    return (
      <BreadcrumbLink asChild className="truncate">
        <Link to={item.to as never}>{item.label}</Link>
      </BreadcrumbLink>
    );
  }
  if (isCurrent) {
    return <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>;
  }
  return <span className="truncate text-neutral-fg">{item.label}</span>;
}

/**
 * The registered trail, on one line. With `beforeTabs`, every item is an
 * ancestor and a trailing separator leads into the tab strip; no item carries
 * `aria-current` then, because the selected tab marks where the user is.
 */
export function AppBreadcrumbs({
  beforeTabs = false,
  className,
}: {
  beforeTabs?: boolean;
  className?: string;
}) {
  const items = useBreadcrumbStore(selectTrail);
  if (!items?.length) return null;

  return (
    <Breadcrumb className={cn("min-w-0", className)}>
      <BreadcrumbList className="flex-nowrap gap-1.5 sm:gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isCurrent = isLast && !beforeTabs && !item.to;
          return (
            <Fragment key={`${index}:${item.label}`}>
              <BreadcrumbItem className={cn("min-w-0", !isLast && "shrink-0")}>
                <CrumbLabel item={item} isCurrent={isCurrent} />
              </BreadcrumbItem>
              {(!isLast || beforeTabs) && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

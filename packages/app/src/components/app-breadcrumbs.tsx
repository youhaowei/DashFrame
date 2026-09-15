/**
 * The app bar's breadcrumb. Pages declare where they sit with
 * `useAppBreadcrumbs`; the top bar renders the trail, so every page shows it in
 * the same place instead of drawing its own.
 */

import { Breadcrumb } from "@dashframe/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

export interface AppBreadcrumb {
  label: string;
  /** Omit for the current page. */
  to?: string;
}

interface BreadcrumbStore {
  trail: { items: AppBreadcrumb[]; owner: symbol } | null;
  /** `claim` is a page's first registration; later calls only update its own trail. */
  setTrail: (items: AppBreadcrumb[], owner: symbol, claim: boolean) => void;
  releaseTrail: (owner: symbol) => void;
}

export const useBreadcrumbStore = create<BreadcrumbStore>()((set) => ({
  trail: null,
  setTrail: (items, owner, claim) =>
    set((state) =>
      !claim && state.trail && state.trail.owner !== owner
        ? state
        : { trail: { items, owner } },
    ),
  releaseTrail: (owner) =>
    set((state) => (state.trail?.owner === owner ? { trail: null } : state)),
}));

/**
 * Shows `items` in the app bar while the calling component is mounted. Pass
 * `null` until the page knows its trail (say, while its artifact loads).
 *
 * @example
 * useAppBreadcrumbs([{ label: "Reports", to: "/dashboards" }, { label: name }]);
 */
export function useAppBreadcrumbs(items: readonly AppBreadcrumb[] | null) {
  const setTrail = useBreadcrumbStore((state) => state.setTrail);
  const releaseTrail = useBreadcrumbStore((state) => state.releaseTrail);
  // One identity for the component's lifetime, so an outgoing page whose data
  // resolves late can't take the bar back from the page that replaced it.
  const [owner] = useState(() => Symbol("app-breadcrumbs"));
  const hasClaimedRef = useRef(false);
  // Compared by content, so a fresh array literal each render doesn't re-set.
  const key = items ? JSON.stringify(items) : null;

  useEffect(() => {
    if (key === null) return;
    setTrail(JSON.parse(key) as AppBreadcrumb[], owner, !hasClaimedRef.current);
    hasClaimedRef.current = true;
  }, [key, owner, setTrail]);

  useEffect(() => () => releaseTrail(owner), [owner, releaseTrail]);
}

export function AppBreadcrumbs() {
  const items = useBreadcrumbStore((state) => state.trail?.items);
  if (!items?.length) return null;
  return (
    <div className="min-w-0 truncate">
      <Breadcrumb LinkComponent={Link} items={items} />
    </div>
  );
}

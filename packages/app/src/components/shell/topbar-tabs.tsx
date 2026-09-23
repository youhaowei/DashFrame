import {
  orderWorkbenchTabs,
  type WorkbenchTabItem,
  type WorkbenchTabsProps,
} from "@dashframe/ui";
import { usePlatform } from "@/lib/platform";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * What a page puts in the top bar's tab slot: the artifact's items (charts on
 * an insight, tables on a data source, drafts under review). Any kind of item
 * fits — the slot knows tabs, not artifacts.
 */
export interface TopBarTabs extends Omit<WorkbenchTabsProps, "className"> {
  /** Closes a tab marked `closable`. Without it, ⌘W / Ctrl+W is left alone. */
  onClose?: (id: string) => void;
}

interface TopBarTabsRegistry {
  register: (tabs: TopBarTabs | null, owner: symbol) => void;
  release: (owner: symbol) => void;
}

interface RegisteredTopBarTabs {
  /** `null` while the page shows no tabs; it keeps its place meanwhile. */
  tabs: TopBarTabs | null;
  owner: symbol;
}

const TopBarTabsRegistryContext = createContext<TopBarTabsRegistry | null>(
  null,
);
const TopBarTabsContext = createContext<TopBarTabs | null | undefined>(
  undefined,
);

export function TopBarTabsProvider({ children }: { children: ReactNode }) {
  // Every mounted page that uses the slot, in the order they mounted. The
  // newest one with tabs is shown. Keeping the older ones means a later page
  // that unmounts first (an aborted navigation, a Suspense retry) hands the
  // slot back to the page still on screen instead of leaving it empty.
  const [registered, setRegistered] = useState<RegisteredTopBarTabs[]>([]);

  const register = useCallback((tabs: TopBarTabs | null, owner: symbol) => {
    setRegistered((current) => {
      const index = current.findIndex((entry) => entry.owner === owner);
      if (index === -1) return [...current, { tabs, owner }];
      // Updates replace the entry in place, including a switch to or from
      // `null`, so a page that was superseded never moves back on top of a
      // newer one.
      const next = [...current];
      next[index] = { tabs, owner };
      return next;
    });
  }, []);

  const release = useCallback((owner: symbol) => {
    setRegistered((current) => {
      const next = current.filter((entry) => entry.owner !== owner);
      return next.length === current.length ? current : next;
    });
  }, []);

  const registry = useMemo(() => ({ register, release }), [register, release]);
  const tabs = registered.findLast((entry) => entry.tabs)?.tabs ?? null;

  const { isMacOS } = usePlatform();
  useTopBarTabShortcuts(tabs, isMacOS);

  return (
    <TopBarTabsRegistryContext.Provider value={registry}>
      <TopBarTabsContext.Provider value={tabs}>
        {children}
      </TopBarTabsContext.Provider>
    </TopBarTabsRegistryContext.Provider>
  );
}

/** The tabs the top bar should show, or `null` when no page registered any. */
export function useRegisteredTopBarTabs(): TopBarTabs | null {
  const tabs = useContext(TopBarTabsContext);
  if (tabs === undefined) {
    throw new Error(
      "useRegisteredTopBarTabs must be used inside TopBarTabsProvider",
    );
  }
  return tabs;
}

/**
 * Show `tabs` in the top bar while the calling component is mounted. Pass
 * `null` to show none. The most recently mounted page with tabs is shown;
 * unmounting removes only this page's registration, so an earlier page that
 * is still mounted gets the slot back.
 */
export function useTopBarTabs(tabs: TopBarTabs | null): void {
  const registry = useContext(TopBarTabsRegistryContext);
  if (!registry) {
    throw new Error("useTopBarTabs must be used inside TopBarTabsProvider");
  }
  const { register, release } = registry;
  // One identity for the component's lifetime, so an update replaces the
  // registration in place and the page keeps its place in mount order.
  const [owner] = useState(() => Symbol("top-bar-tabs"));

  useEffect(() => {
    register(tabs, owner);
  }, [register, owner, tabs]);

  useEffect(() => () => release(owner), [release, owner]);
}

export type TopBarTabShortcut =
  | { action: "select"; id: string }
  | { action: "close"; id: string };

interface ShortcutKeys {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Maps a keydown to what it does to the registered tabs, or `null` when it is
 * not a tab shortcut:
 *
 * - ⌘W (Ctrl+W off macOS) closes the active tab when it is `closable` and the
 *   page handles `onClose`. Otherwise it is not claimed, so closing the
 *   window keeps working.
 * - Ctrl+Tab / Ctrl+Shift+Tab select the next / previous tab in the order the
 *   strip shows them, wrapping. Dashed tabs make something rather than open
 *   something (a new chart), so cycling passes over them.
 */
export function resolveTopBarTabShortcut(
  event: ShortcutKeys,
  tabs: TopBarTabs,
  isMac: boolean,
): TopBarTabShortcut | null {
  if (event.altKey) return null;
  return closeShortcut(event, tabs, isMac) ?? cycleShortcut(event, tabs);
}

function closeShortcut(
  event: ShortcutKeys,
  tabs: TopBarTabs,
  isMac: boolean,
): TopBarTabShortcut | null {
  const modifier = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!modifier || event.shiftKey || event.key.toLowerCase() !== "w") {
    return null;
  }
  const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
  if (!active?.closable || !tabs.onClose) return null;
  return { action: "close", id: active.id };
}

function cycleShortcut(
  event: ShortcutKeys,
  tabs: TopBarTabs,
): TopBarTabShortcut | null {
  if (event.key !== "Tab" || !event.ctrlKey || event.metaKey) return null;
  const cycle = orderWorkbenchTabs(tabs.tabs).filter(
    (tab: WorkbenchTabItem) => !tab.dashed || tab.id === tabs.activeId,
  );
  if (cycle.length < 2) return null;
  const current = cycle.findIndex((tab) => tab.id === tabs.activeId);
  // With no active tab in the cycle, forward starts at the first tab and
  // backward at the last.
  const from = current === -1 && event.shiftKey ? 0 : current;
  const step = event.shiftKey ? -1 : 1;
  const target = cycle[(from + step + cycle.length) % cycle.length];
  if (!target || target.id === tabs.activeId) return null;
  return { action: "select", id: target.id };
}

function useTopBarTabShortcuts(tabs: TopBarTabs | null, isMac: boolean) {
  // Read through a ref so the listener is attached once while tabs are shown,
  // not again on every update that hands the page a new callback.
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const hasTabs = tabs !== null;

  useEffect(() => {
    if (!hasTabs) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const current = tabsRef.current;
      if (!current) return;
      const shortcut = resolveTopBarTabShortcut(event, current, isMac);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut.action === "close") current.onClose?.(shortcut.id);
      else current.onSelect(shortcut.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasTabs, isMac]);
}

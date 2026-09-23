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
  claim: (tabs: TopBarTabs, owner: symbol, claim: boolean) => void;
  release: (owner: symbol) => void;
}

interface RegisteredTopBarTabs {
  tabs: TopBarTabs;
  owner: symbol;
}

const TopBarTabsRegistryContext = createContext<TopBarTabsRegistry | null>(
  null,
);
const TopBarTabsContext = createContext<TopBarTabs | null | undefined>(
  undefined,
);

export function TopBarTabsProvider({ children }: { children: ReactNode }) {
  const [registered, setRegistered] = useState<RegisteredTopBarTabs | null>(
    null,
  );

  const claim = useCallback(
    (tabs: TopBarTabs, owner: symbol, isClaim: boolean) => {
      setRegistered((current) => {
        // A page that was superseded — the next route mounted its tabs before
        // this one unmounted — may not take the slot back on a late update.
        if (!isClaim && current && current.owner !== owner) return current;
        return { tabs, owner };
      });
    },
    [],
  );

  const release = useCallback((owner: symbol) => {
    setRegistered((current) => (current?.owner === owner ? null : current));
  }, []);

  const registry = useMemo(() => ({ claim, release }), [claim, release]);
  const tabs = registered?.tabs ?? null;

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
 * `null` to show none. The latest registration wins; unmounting clears the
 * slot only if this component still holds it.
 */
export function useTopBarTabs(tabs: TopBarTabs | null): void {
  const registry = useContext(TopBarTabsRegistryContext);
  if (!registry) {
    throw new Error("useTopBarTabs must be used inside TopBarTabsProvider");
  }
  const { claim, release } = registry;
  // One identity for the component's lifetime, so an update replaces the
  // registration in place instead of releasing and re-claiming it.
  const [owner] = useState(() => Symbol("top-bar-tabs"));
  const hasClaimedRef = useRef(false);

  useEffect(() => {
    if (!tabs) {
      if (hasClaimedRef.current) release(owner);
      hasClaimedRef.current = false;
      return;
    }
    claim(tabs, owner, !hasClaimedRef.current);
    hasClaimedRef.current = true;
  }, [claim, release, owner, tabs]);

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

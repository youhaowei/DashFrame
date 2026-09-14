import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@wystack/ui-react";
import { SearchIcon } from "@wystack/ui-react/icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { OverlayScrollArea } from "./OverlayScrollArea";

export interface WorkbenchTabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Keeps the tab at an end of the strip instead of in the scrolling middle. */
  pinned?: "start" | "end";
  /** Dashed outline: the tab makes something rather than opening something. */
  dashed?: boolean;
  /** Dot marking work that has not been saved yet. */
  unsaved?: boolean;
}

export interface WorkbenchTabsProps {
  /** Accessible name for the strip. */
  label: string;
  tabs: WorkbenchTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Id of the region these tabs control, so each tab can point at it. */
  panelId?: string;
  /** Label for the search control shown once the strip overflows. */
  findLabel?: string;
  findEmptyLabel?: string;
  className?: string;
}

// Slack the overflow test so a sub-pixel layout never flickers the control.
const OVERFLOW_SLACK = 8;
const FINDER_GAP_PX = 4;

const ARROW_KEYS = ["ArrowRight", "ArrowLeft", "Home", "End"];

// Read per call rather than once: the preference can change while the app is
// open, and a viewer who turns motion off mid-session means it immediately.
function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The strip's single Tab stop follows focus rather than selection: activation
 * is manual, so the two differ while arrowing, and tabbing back into the strip
 * has to return where the user left it. It falls back to the selected tab when
 * the remembered one is gone — a chart can be deleted while focus sits on its
 * tab — so the strip always has exactly one stop.
 */
function resolveTabStop(
  tabs: WorkbenchTabItem[],
  focusedId: string | null,
  activeId: string,
): string | undefined {
  const has = (id: string | null) => tabs.some((tab) => tab.id === id);
  if (has(focusedId) && focusedId !== null) return focusedId;
  if (has(activeId)) return activeId;
  return tabs[0]?.id;
}

function TabButton({
  tab,
  active,
  tabStop,
  panelId,
  onSelect,
  onFocus,
}: {
  tab: WorkbenchTabItem;
  active: boolean;
  /** Whether this tab is the strip's single Tab stop. */
  tabStop: boolean;
  panelId?: string;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      // Roving tabindex: the strip is a single Tab stop, and the arrow keys
      // move between tabs inside it.
      tabIndex={tabStop ? 0 : -1}
      data-tab-id={tab.id}
      onClick={() => onSelect(tab.id)}
      onFocus={() => onFocus(tab.id)}
      // The dot is decorative, so the unsaved state rides on the description
      // instead — folding it into the accessible name would rename the tab.
      title={tab.unsaved ? `${tab.label} — not saved` : tab.label}
      className={cn(
        "flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
        "transition-colors duration-150 motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
        tab.dashed && "border border-dashed border-neutral-border",
        active
          ? "bg-neutral-bg-muted text-neutral-fg"
          : "text-neutral-fg-subtle hover:bg-neutral-bg-muted/60 hover:text-neutral-fg",
      )}
    >
      {tab.icon && <span className="shrink-0">{tab.icon}</span>}
      <span className="truncate">{tab.label}</span>
      {tab.unsaved && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-palette-primary"
        />
      )}
    </button>
  );
}

/**
 * Horizontal strip of canvas tabs. Tabs pinned to either end stay put while
 * the rest scroll between them, and a search control appears only once there
 * are more tabs than fit.
 */
export function WorkbenchTabs({
  label,
  tabs,
  activeId,
  onSelect,
  panelId,
  findLabel = "Find",
  findEmptyLabel = "No matches.",
  className,
}: WorkbenchTabsProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const finderRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const tabStopId = resolveTabStop(tabs, focusedId, activeId);

  const start = tabs.filter((tab) => tab.pinned === "start");
  const end = tabs.filter((tab) => tab.pinned === "end");
  const middle = tabs.filter((tab) => !tab.pinned);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setOverflowing((finderVisible) => {
      // Once shown, the finder takes width away from the viewport. Add that
      // width back when asking whether the tabs would fit without it, or the
      // finder can keep itself visible after a chart is deleted or the window
      // widens just enough for the tabs alone.
      const finderFootprint = finderVisible
        ? (finderRef.current?.offsetWidth ?? 0) + FINDER_GAP_PX
        : 0;
      return (
        viewport.scrollWidth - (viewport.clientWidth + finderFootprint) >
        OVERFLOW_SLACK
      );
    });
  }, []);

  // A ResizeObserver catches the pane narrowing, and nothing else: the track is
  // a block-level flex container, so its own box stays clamped to the viewport
  // width however many tabs it holds, and adding one never resizes anything.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [measure]);

  // So the other cause — the tab set itself changing — is measured here. Tabs
  // arrive well after mount (the saved chart list loads from the server), and
  // without this the strip would overflow with no scrollbar and no finder.
  useLayoutEffect(() => {
    measure();
  }, [measure, tabs]);

  const revealTab = useCallback((id: string, smooth: boolean) => {
    const strip = stripRef.current;
    if (!strip) return;
    // Matched by value rather than built into a selector, so an id carrying
    // characters a selector would choke on still finds its tab.
    const match = [...strip.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (tab) => tab.dataset.tabId === id,
    );
    match?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      // Scripted scrolling is animation too, so it follows the same
      // reduced-motion rule the CSS transitions on these tabs do.
      behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
    });
  }, []);

  // Reveal whichever tab is active, however it was activated — clicking one is
  // only one of the ways, alongside saving a chart, restoring a persisted view,
  // and picking a chart in the visualization pane.
  useEffect(() => {
    revealTab(activeId, true);
  }, [activeId, revealTab]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.includes(event.key)) return;
    const strip = stripRef.current;
    if (!strip) return;
    const focusable = [
      ...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ];
    const current = focusable.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (current === -1) return;
    event.preventDefault();
    let next: number;
    if (event.key === "ArrowRight") next = (current + 1) % focusable.length;
    else if (event.key === "ArrowLeft")
      next = (current - 1 + focusable.length) % focusable.length;
    else if (event.key === "Home") next = 0;
    else next = focusable.length - 1;
    // Focus moves without selecting: opening a chart loads data, so the user
    // confirms with Enter or Space rather than arrowing through every chart.
    focusable[next]?.focus();
    focusable[next]?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, []);

  return (
    // The finder is a strip-level control rather than a tab, so it sits
    // outside the tablist: a tablist may own tabs and nothing else.
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      {/* One tablist spans the tabs: the pinned ends and the scrolling
          middle are all tabs for the same canvas. */}
      <div
        ref={stripRef}
        role="tablist"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        {start.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            tabStop={tab.id === tabStopId}
            panelId={panelId}
            onSelect={onSelect}
            onFocus={setFocusedId}
          />
        ))}
        <OverlayScrollArea
          orientation="horizontal"
          scrollbar="none"
          className="min-w-0 flex-1"
          viewportRef={viewportRef}
          // Base UI would make the overflowing viewport its own tab stop. Every
          // tab inside is already reachable by Tab and the arrow keys, and an
          // unnamed focusable element inside a tablist fails WCAG 4.1.2.
          viewportTabIndex={-1}
        >
          {/* Trailing room keeps the last tab clear of the edge fade. */}
          <div className="flex gap-1 pr-6">
            {middle.map((tab) => (
              <TabButton
                key={tab.id}
                tab={tab}
                active={tab.id === activeId}
                tabStop={tab.id === tabStopId}
                panelId={panelId}
                onSelect={onSelect}
                onFocus={setFocusedId}
              />
            ))}
          </div>
        </OverlayScrollArea>
        {end.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            tabStop={tab.id === tabStopId}
            panelId={panelId}
            onSelect={onSelect}
            onFocus={setFocusedId}
          />
        ))}
      </div>
      {overflowing && (
        <div ref={finderRef} className="shrink-0">
          <Popover open={findOpen} onOpenChange={setFindOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={findLabel}
                  title={findLabel}
                  className={cn(
                    "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
                    "text-neutral-fg-subtle transition-colors duration-150 motion-reduce:transition-none",
                    "hover:bg-neutral-bg-muted/60 hover:text-neutral-fg",
                    "focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
                  )}
                >
                  <SearchIcon aria-hidden className="size-3.5" />
                  <span>{findLabel}</span>
                </button>
              }
            />
            <PopoverContent align="end" className="w-64 p-0">
              <Command label={label}>
                <CommandInput placeholder={`${findLabel}…`} />
                <CommandList>
                  <CommandEmpty>{findEmptyLabel}</CommandEmpty>
                  {tabs.map((tab) => (
                    <CommandItem
                      key={tab.id}
                      // Ids, not labels: two charts over the same columns get the
                      // same name, and matching items by name would highlight
                      // both and open whichever came first.
                      value={tab.id}
                      keywords={[tab.label]}
                      onSelect={() => {
                        setFindOpen(false);
                        onSelect(tab.id);
                      }}
                    >
                      {tab.icon && <span className="shrink-0">{tab.icon}</span>}
                      <span className="truncate">{tab.label}</span>
                      {tab.unsaved && (
                        <span className="ml-auto size-1.5 shrink-0 rounded-full bg-palette-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}

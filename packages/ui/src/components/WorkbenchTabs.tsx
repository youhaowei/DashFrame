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

const ARROW_KEYS = ["ArrowRight", "ArrowLeft", "Home", "End"];

function TabButton({
  tab,
  active,
  panelId,
  onSelect,
}: {
  tab: WorkbenchTabItem;
  active: boolean;
  panelId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      // Roving tabindex: the strip is a single Tab stop, and the arrow keys
      // move between tabs inside it.
      tabIndex={active ? 0 : -1}
      data-tab-id={tab.id}
      onClick={() => onSelect(tab.id)}
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
  const [overflowing, setOverflowing] = useState(false);
  const [findOpen, setFindOpen] = useState(false);

  const start = tabs.filter((tab) => tab.pinned === "start");
  const end = tabs.filter((tab) => tab.pinned === "end");
  const middle = tabs.filter((tab) => !tab.pinned);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setOverflowing(
      viewport.scrollWidth - viewport.clientWidth > OVERFLOW_SLACK,
    );
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

  // Base UI makes an overflowing viewport a tab stop of its own. Every tab
  // inside it is already reachable by Tab and the arrow keys, so the scroller
  // does not need one — and an unnamed focusable presentation element sitting
  // inside a tablist is a WCAG 4.1.2 failure. No dep array: this has to win
  // again on every render that re-applies Base UI's own tabIndex.
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.tabIndex = -1;
  });

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
      behavior: smooth ? "smooth" : "auto",
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
    // One tablist spans the strip: the pinned ends and the scrolling middle
    // are all tabs for the same canvas.
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn("flex min-w-0 items-center gap-1", className)}
    >
      {start.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          panelId={panelId}
          onSelect={onSelect}
        />
      ))}
      <OverlayScrollArea
        orientation="horizontal"
        scrollbar="none"
        className="min-w-0 flex-1"
        viewportRef={viewportRef}
      >
        {/* Trailing room keeps the last tab clear of the edge fade. */}
        <div className="flex gap-1 pr-6">
          {middle.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              panelId={panelId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </OverlayScrollArea>
      {overflowing && (
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
      )}
      {end.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          panelId={panelId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

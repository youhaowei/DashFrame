import { queryStatus } from "@/data/query-status";
import { usePlatform } from "@/lib/platform";
import { api } from "@dashframe/convex-backend/api";
import { cmd, type UUID } from "@dashframe/types";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@wystack/ui-react";
import {
  ArrowRightIcon,
  CalculatorIcon,
  ChartIcon,
  DatabaseIcon,
  FileIcon,
  GridIcon,
  PlusIcon,
  TableIcon,
} from "@wystack/ui-react/icons";
import { useMutation, useQuery_experimental as useQuery } from "convex/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import {
  isCommandPaletteShortcut,
  useCommandPalette,
} from "./command-palette-store";
import {
  buildPaletteResults,
  type PaletteItem,
  type PaletteTarget,
} from "./command-palette-results";

const ICON_CLASS = "text-neutral-fg-subtle";

function ItemIcon({ item }: { item: PaletteItem }) {
  switch (item.kind) {
    case "report":
      return <GridIcon className={ICON_CLASS} aria-hidden />;
    case "chart":
      return <ChartIcon className={ICON_CLASS} aria-hidden />;
    case "data-source":
      return <DatabaseIcon className={ICON_CLASS} aria-hidden />;
    case "table":
      return <TableIcon className={ICON_CLASS} aria-hidden />;
    case "metric":
      return <CalculatorIcon className={ICON_CLASS} aria-hidden />;
    case "draft":
      return <FileIcon className={ICON_CLASS} aria-hidden />;
    case "action":
      return item.target.kind === "action" &&
        item.target.action.startsWith("go-") ? (
        <ArrowRightIcon className={ICON_CLASS} aria-hidden />
      ) : (
        <PlusIcon className={ICON_CLASS} aria-hidden />
      );
  }
}

/** `pathname` is `base`, with or without a trailing slash. */
function isPath(pathname: string, base: string): boolean {
  return pathname === base || pathname === `${base}/`;
}

/** `/data-sources`, with or without the trailing slash of its index route. */
function isDataSourcesPath(pathname: string): boolean {
  return isPath(pathname, "/data-sources");
}

/**
 * Whether opening `target` from `pathname` stays inside the artifact already
 * open: the same report, the same data source, or the drafts, whose tabs are
 * all drafts.
 */
export function replacesEntry(
  target: PaletteTarget,
  pathname: string,
): boolean {
  switch (target.kind) {
    case "report":
    case "chart":
      return isPath(pathname, `/dashboards/${target.reportId}`);
    case "data-source":
      return isPath(pathname, `/data-sources/${target.sourceId}`);
    case "draft":
      return isPath(pathname, "/drafts") || pathname.startsWith("/drafts/");
    case "action":
      return false;
  }
}

/** A dialog, alert dialog or popover other than the palette is open. */
function anotherDialogIsOpen(): boolean {
  return (
    document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
  );
}

/**
 * The app-wide command palette: search reports, charts on a report, data
 * sources and tables, saved metrics and drafts, or run an action. Mounted
 * once in the shell; ⌘K (Ctrl+K off macOS) toggles it from anywhere.
 */
export function CommandPalette() {
  const open = useCommandPalette((state) => state.open);
  const setOpen = useCommandPalette((state) => state.setOpen);
  const toggle = useCommandPalette((state) => state.toggle);
  const { isMacOS } = usePlatform();
  const navigate = useNavigate();
  const router = useRouter();
  const commitBatch = useMutation(api.app.commitBatch);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!isCommandPaletteShortcut(event, isMacOS)) return;
      // Browsers bind ⌘K / Ctrl+K to their own search, which would take focus
      // out of the page (and out of any open dialog), so claim it either way.
      event.preventDefault();
      // Another dialog or popover owns the keyboard; the palette would open
      // on top of it. Its own shortcut closes it, so only an opening waits.
      if (!useCommandPalette.getState().open && anotherDialogIsOpen()) return;
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMacOS, toggle]);

  const run = useCallback(
    async (target: PaletteTarget) => {
      setOpen(false);
      // Switching tabs inside the artifact already open is not a page visit,
      // so it replaces the entry as the page's own tabs do; Back then leaves
      // the artifact instead of stepping through its tabs.
      const replace = replacesEntry(target, router.state.location.pathname);
      switch (target.kind) {
        case "report":
          await navigate({
            to: `/dashboards/${target.reportId}`,
            replace,
          } as never);
          return;
        case "chart":
          // The chart is on this report already, so opening its tab only navigates.
          await navigate({
            to: `/dashboards/${target.reportId}`,
            search: { chart: target.chartId },
            replace,
          } as never);
          return;
        case "data-source":
          await navigate({
            to: `/data-sources/${target.sourceId}`,
            search: { table: target.tableId },
            replace,
          } as never);
          return;
        case "draft":
          await navigate({
            to: `/drafts/${target.draftId}`,
            replace,
          } as never);
          return;
        case "action":
          switch (target.action) {
            case "new-report": {
              const id = crypto.randomUUID() as UUID;
              try {
                await commitBatch({
                  commands: [
                    cmd("CreateDashboard", { id, name: "Untitled report" }),
                  ],
                });
              } catch {
                toast.error("Couldn't create a report. Please try again.");
                return;
              }
              await navigate({ to: `/dashboards/${id}` } as never);
              return;
            }
            case "add-data-source":
              // The dialog belongs to the Data sources page, where a new
              // source appears when it is done. Already on that page, opening
              // it replaces the entry, as closing it does, so Back leaves the
              // page instead of landing on the same page again.
              await navigate({
                to: "/data-sources",
                search: { addSource: true },
                replace: isDataSourcesPath(router.state.location.pathname),
              } as never);
              return;
            case "go-reports":
              await navigate({ to: "/dashboards" } as never);
              return;
            case "go-data-sources":
              await navigate({ to: "/data-sources" } as never);
              return;
            case "go-drafts":
              await navigate({ to: "/drafts" } as never);
          }
      }
    },
    [commitBatch, navigate, router, setOpen],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search reports, charts, data sources, tables, saved metrics and drafts, or run an action."
      footer={<KeyHints />}
      className="duration-150"
    >
      <PaletteBody onRun={run} onClose={() => setOpen(false)} />
    </CommandDialog>
  );
}

/**
 * The search and its results. Rendered inside the dialog, so the query starts
 * empty on every open. The lists are the ones the shell already subscribes to
 * (see WebMCPProvider); the same query and arguments share one subscription.
 * A list that fails, such as one over the 1000-row cap, drops out and the
 * others still show.
 */
function PaletteBody({
  onRun,
  onClose,
}: {
  onRun: (target: PaletteTarget) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const { isMacOS } = usePlatform();
  const reportsList = queryStatus(
    useQuery({ query: api.app.listDashboards, args: {} }),
  );
  const chartsList = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  );
  const dataSourcesList = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const dataTablesList = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const draftsList = queryStatus(
    useQuery({ query: api.app.listDrafts, args: {} }),
  );
  const reports = reportsList.data;
  const charts = chartsList.data;
  const dataSources = dataSourcesList.data;
  const dataTables = dataTablesList.data;
  const drafts = draftsList.data;
  const lists = [
    reportsList,
    chartsList,
    dataSourcesList,
    dataTablesList,
    draftsList,
  ];
  // An empty result is only "no results" once every list has answered.
  const loading = lists.some((list) => list.isLoading);
  const failed = lists.some((list) => list.isError);
  let emptyMessage = "No results";
  if (loading) emptyMessage = "Loading…";
  else if (failed) emptyMessage = "No results. Some lists couldn't load.";

  const groups = useMemo(
    () =>
      buildPaletteResults(
        { reports, charts, dataSources, dataTables, drafts },
        search,
      ),
    [reports, charts, dataSources, dataTables, drafts, search],
  );

  return (
    // The results arrive filtered, ranked and in their fixed group order, so
    // cmdk must not filter or re-sort them. `CommandDialog` does not forward
    // cmdk's root props, so this inner root carries `shouldFilter` until it
    // does. Its keys are handled here and marked handled, so the dialog's
    // empty root skips them.
    <Command
      label="Search"
      shouldFilter={false}
      loop
      onKeyDown={(event) => {
        // cmdk's vim bindings read Ctrl+K as "move up" and consume it; close
        // first, so Ctrl+K toggles off macOS as ⌘K does on macOS.
        if (isCommandPaletteShortcut(event, isMacOS)) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      className="min-h-0 flex-1 rounded-none bg-transparent"
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search or run an action…"
      />
      <CommandList>
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={group.heading}>
            {group.items.map((item) => (
              <PaletteRow key={item.id} item={item} onRun={onRun} />
            ))}
          </CommandGroup>
        ))}
        {groups.length > 0 && (loading || failed) ? (
          <p className="px-4 py-2 text-xs text-neutral-fg-subtle">
            {loading ? "Still loading…" : "Some lists couldn't load."}
          </p>
        ) : null}
      </CommandList>
    </Command>
  );
}

function PaletteRow({
  item,
  onRun,
}: {
  item: PaletteItem;
  onRun: (target: PaletteTarget) => void;
}) {
  return (
    <CommandItem value={item.id} onSelect={() => onRun(item.target)}>
      <ItemIcon item={item} />
      <span className="min-w-0 truncate">{item.label}</span>
      {item.detail ? (
        <span className="ml-auto shrink-0 pl-4 text-xs text-neutral-fg-subtle">
          {item.detail}
        </span>
      ) : null}
    </CommandItem>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded bg-neutral-bg-subtle px-1 font-sans text-[11px] text-neutral-fg-subtle">
      {children}
    </kbd>
  );
}

function KeyHints() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <Key>↑</Key>
        <Key>↓</Key>
        move
      </span>
      <span className="flex items-center gap-1">
        <Key>↵</Key>
        open
      </span>
      <span className="flex items-center gap-1">
        <Key>esc</Key>
        close
      </span>
    </div>
  );
}

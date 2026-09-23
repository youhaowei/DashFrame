import { DataPickerModal } from "@/components/data-sources/DataPickerModal";
import { Ga4PropertyPicker } from "@/components/data-sources/Ga4PropertyPicker";
import { RefreshTableButton } from "@/components/data-sources/RefreshTableButton";
import { AppLayout } from "@/components/layouts/AppLayout";
import { useTopBarTabs } from "@/components/shell/topbar-tabs";
import {
  Workbench,
  WorkbenchPaneToggle,
  useWorkbenchPanes,
} from "@/components/workbench/Workbench";
import { queryStatus } from "@/data/query-status";
import { useCreateInsight } from "@/hooks/useCreateInsight";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import {
  getConnectorById,
  useRegistryVersion,
} from "@/lib/connectors/registry";
import { PerfStage, withPerfAsync } from "@/lib/perf";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { api } from "@dashframe/convex-backend/api";
import { extractColumnAliasComponents } from "@dashframe/engine";
import type {
  ColumnAnalysis,
  DataSource,
  DataTable,
  Field,
  FieldSensitivity,
  UUID,
} from "@dashframe/types";
import { buildSensitivityUpdate, cmd } from "@dashframe/types";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Toggle,
} from "@wystack/ui-react";
import {
  DashboardIcon,
  DeleteIcon,
  ListIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  TableIcon,
} from "@wystack/ui-react/icons";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ColumnInspector } from "./ColumnInspector";
import {
  ImportTablesDialog,
  isListableRemoteConnector,
} from "./ImportTablesDialog";
import { SourceConfigPane } from "./SourceConfigPane";
import {
  TablePreview,
  sampleColumnValues,
  type TablePreviewView,
} from "./TablePreview";

const TABLE_PANEL_ID = "data-source-table-panel";
const PREVIEW_ROW_LIMIT = 50;
const NO_TABLES: DataTable[] = [];

interface DataSourcePageContentProps {
  sourceId: string;
  /** The open table tab from the URL; the first table when absent or stale. */
  tableId: string | null;
  /** Opens a table tab, or clears the choice with `null`. */
  onSelectTable: (tableId: string | null) => void;
}

const SENSITIVITY_TOASTS: Record<FieldSensitivity, string> = {
  sensitive: "Column marked sensitive",
  cleared: "Column marked as not sensitive",
  unclassified: "Column reset to unclassified",
};

/**
 * Build a lookup map from field ID → column analysis.
 *
 * Keys use the same synthetic-ID convention as `buildInsightAvailableFields`:
 * - Base / first-join instance (j0): canonical UUID  → `"<uuid>"`
 * - Repeat-join j1, j2, …:          instance-qualified → `"<uuid>_j1"`, `"<uuid>_j2"`
 *
 * This prevents a repeat-join's j1 analysis from overwriting j0's in the map,
 * and ensures that `analysisByFieldId.get(field.id)` returns the correct instance
 * for every field shown in the UI.
 *
 * Exported for unit testing.
 */
export function buildAnalysisByFieldId(
  columns: ColumnAnalysis[],
): Map<string, ColumnAnalysis> {
  const map = new Map<string, ColumnAnalysis>();
  for (const column of columns) {
    if (column.fieldId) {
      // Fast-path: analysis already carries an explicit fieldId.
      // IMPORTANT: if fieldId is ever populated via extractUUIDFromColumnAlias
      // (which strips the _jN suffix), this path will silently re-introduce the
      // j1-overwrites-j0 collapse. The only safe source for fieldId here is a
      // value already instance-qualified (e.g. "<uuid>_j1") — matching the keys
      // produced by buildInsightAvailableFields.
      // As of today, analyze.ts does NOT persist fieldId onto ColumnAnalysis, so
      // this branch is dead. Keep it as-is to not break any future caller that
      // correctly provides instance-qualified fieldIds.
      map.set(column.fieldId, column);
      continue;
    }
    const components = extractColumnAliasComponents(column.columnName);
    if (!components) continue;
    const fieldId =
      components.instanceIndex === 0
        ? components.uuid
        : `${components.uuid}_j${components.instanceIndex}`;
    map.set(fieldId, column);
  }
  return map;
}

function CentreMessage({
  title,
  line,
  action,
  role,
}: {
  title: string;
  line: string;
  action?: React.ReactNode;
  role?: "alert";
}) {
  return (
    <div
      role={role}
      className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center"
    >
      <h2 className="text-base font-semibold text-neutral-fg">{title}</h2>
      <p className="text-sm text-neutral-fg-subtle">{line}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/**
 * Data source page: the source's tables as top-bar tabs, the source's own
 * configuration on the left, the open table in the centre, and the selected
 * column's inspector on the right.
 */
export default function DataSourcePageContent({
  sourceId,
  tableId,
  onSelectTable,
}: DataSourcePageContentProps) {
  const navigate = useNavigate();
  const { createInsightFromTable } = useCreateInsight();

  // Subscribe so a re-render fires once the connector registry hydrates from
  // the server catalog (getConnectorById reads a module-scope map, which is
  // not reactive on its own).
  useRegistryVersion();

  const {
    data: allDataSources = [],
    isLoading,
    isFetching,
  } = queryStatus(useQuery({ query: api.app.listDataSources, args: {} }));
  const commitBatch = useMutation(api.app.commitBatch);
  const { confirm } = useConfirmDialogStore();
  const { data: allDataFrames = [] } = queryStatus(
    useQuery({ query: api.app.listDataFrames, args: {} }),
  );
  const dataSource = allDataSources.find((s) => s.id === sourceId);

  const {
    data: loadedTables,
    isLoading: isLoadingDataTables,
    isError: isDataTablesError,
  } = queryStatus(
    useQuery({
      query: api.app.listDataTables,
      args: { dataSourceId: sourceId },
    }),
  );

  // A stable empty list keeps the tab list below memoized while loading.
  const dataTables = loadedTables ?? NO_TABLES;

  // Holds the first-property picker on screen while its import runs.
  const [isImportingFirstTable, setIsImportingFirstTable] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isStartingReport, setIsStartingReport] = useState(false);
  const [view, setView] = useState<TablePreviewView>("grid");
  // Selections belong to the table they were made on; switching tabs starts
  // the next table clean instead of carrying a column that is not there.
  const [columnFind, setColumnFind] = useState({ tableId: "", query: "" });
  const [selection, setSelection] = useState({ tableId: "", fieldId: "" });

  // A stale or absent tab in the URL falls back to the first table, so a
  // source with tables never needs a separate selection state.
  const selectedTable =
    dataTables.find((table) => table.id === tableId) ?? dataTables[0] ?? null;
  const showTable = selectedTable !== null && !isImportingFirstTable;
  const columnQuery =
    columnFind.tableId === selectedTable?.id ? columnFind.query : "";
  const selectedField =
    selection.tableId === selectedTable?.id
      ? (selectedTable.fields.find((field) => field.id === selection.fieldId) ??
        null)
      : null;

  const connector = dataSource ? getConnectorById(dataSource.type) : null;
  const isFileSource = connector?.sourceType === "file";
  const isRemoteSource = connector?.sourceType === "remote-api";
  const canImport =
    isFileSource ||
    (dataSource !== undefined && isListableRemoteConnector(dataSource.type));

  const dataFrameEntry = selectedTable?.dataFrameId
    ? (allDataFrames.find((entry) => entry.id === selectedTable.dataFrameId) ??
      null)
    : null;
  const preview = useDataFrameData(selectedTable?.dataFrameId, {
    limit: PREVIEW_ROW_LIMIT,
  });

  // Cached column analysis keyed by field ID, for the inspector's profile and
  // data-driven sensitivity signals beyond name heuristics.
  const analysisByFieldId = useMemo(
    () => buildAnalysisByFieldId(dataFrameEntry?.analysis?.columns ?? []),
    [dataFrameEntry],
  );

  const { leftOpen, rightOpen, setRightOpen, toggleLeft, toggleRight } =
    useWorkbenchPanes("data-source");

  const selectTable = (id: string) => onSelectTable(id);
  useTableTabs(dataTables, showTable ? selectedTable.id : null, onSelectTable);

  // Command-apply boundary: a direct mutation on the artifact. Instrumented
  // so the dev HUD can hold it against the <100ms perceived budget.
  const renameSource = async (name: string) => {
    try {
      await withPerfAsync(
        PerfStage.CommandApply,
        () =>
          commitBatch({
            commands: [cmd("RenameNode", { id: sourceId as UUID, name })],
          }),
        `data-source:${sourceId}`,
      );
      return true;
    } catch {
      toast.error("Failed to rename data source");
      return false;
    }
  };

  const selectField = (fieldId: string) => {
    if (!selectedTable) return;
    setSelection({ tableId: selectedTable.id, fieldId });
    // Choosing a column asks to inspect it, even if the pane was collapsed.
    setRightOpen(true);
  };

  // A report has no table tile yet, so a new report starts with this table's
  // question open in that report's context; "Add to report" places the view.
  // A question that cannot be opened takes its new, empty report with it.
  const handleStartReport = async () => {
    if (!selectedTable || isStartingReport) return;
    setIsStartingReport(true);
    try {
      await startReport(commitBatch, createInsightFromTable, selectedTable);
    } finally {
      setIsStartingReport(false);
    }
  };

  const handleDeleteTable = () => {
    if (!selectedTable) return;
    const { id, name } = selectedTable;
    confirm({
      title: "Delete data table",
      description: `Are you sure you want to delete "${name}"? This deletes the data table. Related DataFrame metadata and storage, and dependent insights, may remain. This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await commitBatch({ commands: [cmd("DeleteNode", { id })] });
          onSelectTable(null);
        } catch {
          toast.error("Failed to delete data table");
        }
      },
    });
  };

  const openDataSources = () => navigate({ to: "/data-sources" } as never);
  const tablesStatus = tablesStatusOf(isLoadingDataTables, isDataTablesError);

  if (!dataSource) {
    return (
      <SourceUnavailable
        // A pending subscription is not a confirmed absence.
        pending={isLoading || isFetching}
        onOpenDataSources={openDataSources}
      />
    );
  }

  const importButton = (variant: "solid" | "outline") =>
    canImport ? (
      <Button
        size="sm"
        variant={variant}
        icon={PlusIcon}
        label={isFileSource ? "Import file" : "Import table"}
        onClick={() => setIsImportOpen(true)}
      />
    ) : null;

  const centre = showTable ? (
    <>
      <TableToolbar
        columnQuery={columnQuery}
        onColumnQueryChange={(query) =>
          setColumnFind({ tableId: selectedTable.id, query })
        }
        rowCount={dataFrameEntry?.rowCount}
        columnCount={selectedTable.fields.length}
        view={view}
        onViewChange={setView}
      />
      <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg">
        <TablePreview
          fields={selectedTable.fields}
          view={view}
          columnQuery={columnQuery}
          selectedFieldId={selectedField?.id ?? null}
          onSelectField={selectField}
          preview={preview}
        />
      </div>
    </>
  ) : (
    <NoTableCentre
      tablesStatus={tablesStatus}
      sourceId={sourceId as UUID}
      sourceType={dataSource.type}
      isFileSource={isFileSource}
      importAction={importButton("solid")}
      onImported={selectTable}
      onImportingChange={setIsImportingFirstTable}
      onOpenDataSources={openDataSources}
    />
  );

  return (
    <AppLayout pageHeader={null} childrenClassName="overflow-hidden">
      <Workbench
        data-dashframe-source-id={sourceId}
        leftOpen={leftOpen}
        left={
          <SourceConfigPane
            source={dataSource}
            connector={connector}
            table={showTable ? selectedTable : null}
            lastRefreshedAt={dataFrameEntry?.lastRefreshedAt}
          />
        }
        rightOpen={rightOpen && selectedField !== null}
        right={
          selectedField ? (
            <FieldInspectorPane
              // Remount per column so the name field starts from its value.
              key={selectedField.id}
              tableId={selectedField.tableId}
              field={selectedField}
              analysis={analysisByFieldId.get(selectedField.id)}
              sampleValues={sampleColumnValues(
                preview.data?.rows ?? [],
                selectedField,
                5,
              )}
            />
          ) : null
        }
      >
        {/* Collapses by the header's own width, as the insight header does. */}
        <header className="@container flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto px-1 whitespace-nowrap [scrollbar-width:thin] [&>*]:shrink-0 [&>input]:shrink">
          <WorkbenchPaneToggle
            side="left"
            open={leftOpen}
            paneName="Source"
            onToggle={toggleLeft}
          />
          <Link
            to="/data-sources"
            className="shrink-0 rounded-sm px-1 @max-2xl:hidden text-xs text-neutral-fg-subtle transition-colors hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
          >
            Data Sources
          </Link>
          <span
            aria-hidden
            className="shrink-0 text-xs text-neutral-fg-subtle @max-2xl:hidden"
          >
            ›
          </span>
          <SourceNameInput
            savedName={dataSource.name}
            onRename={renameSource}
          />
          {showTable && (
            <TableActions
              table={selectedTable}
              importAction={importButton("outline")}
              canRefresh={isRemoteSource}
              isStartingReport={isStartingReport}
              onStartReport={() => void handleStartReport()}
              onDelete={handleDeleteTable}
            />
          )}
          {selectedField && (
            <WorkbenchPaneToggle
              side="right"
              open={rightOpen}
              paneName="Column"
              onToggle={toggleRight}
            />
          )}
        </header>

        <div
          id={TABLE_PANEL_ID}
          role={showTable ? "tabpanel" : undefined}
          aria-label={showTable ? selectedTable.name : undefined}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg-muted p-2 shadow-inner dark:bg-neutral-bg-dim"
        >
          {centre}
        </div>
      </Workbench>

      <SourceImportDialog
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        source={dataSource}
        isFileSource={isFileSource}
        tables={dataTables}
        onImported={selectTable}
        onOpenDataSources={openDataSources}
      />
    </AppLayout>
  );
}

type TablesStatus = "loading" | "error" | "ready";

/**
 * Creates an "Untitled report" and opens the table's question in its context,
 * where "Add to report" places the view. Reports have no table tile yet, so
 * this is the closest start from a table. Resolves once the question opens.
 */
async function startReport(
  commitBatch: ReturnType<typeof useMutation<typeof api.app.commitBatch>>,
  createInsightFromTable: ReturnType<
    typeof useCreateInsight
  >["createInsightFromTable"],
  table: DataTable,
) {
  const reportId = crypto.randomUUID() as UUID;
  try {
    await commitBatch({
      commands: [
        cmd("CreateDashboard", { id: reportId, name: "Untitled report" }),
      ],
    });
  } catch {
    toast.error("Couldn't start a report");
    return;
  }
  const insightId = await createInsightFromTable(table.id, table.name, {
    visualize: true,
    reportId,
  });
  if (insightId !== null) return;
  // The question failed (already reported); leave no empty report behind.
  try {
    await commitBatch({ commands: [cmd("DeleteNode", { id: reportId })] });
  } catch {
    // The report stays listed and can be deleted from Reports.
  }
}

/** Shows the source's tables as top-bar tabs while one is open. */
function useTableTabs(
  tables: DataTable[],
  activeTableId: string | null,
  onSelectTable: (tableId: string) => void,
) {
  const tabs = useMemo(
    () =>
      activeTableId
        ? {
            label: "Tables",
            tabs: tables.map((table) => ({
              id: table.id,
              label: table.name,
              icon: <TableIcon className="size-3.5" />,
            })),
            activeId: activeTableId,
            onSelect: onSelectTable,
            panelId: TABLE_PANEL_ID,
            findLabel: "Find a table",
            findEmptyLabel: "No matching tables.",
          }
        : null,
    [activeTableId, tables, onSelectTable],
  );
  useTopBarTabs(tabs);
}

function tablesStatusOf(isLoading: boolean, isError: boolean): TablesStatus {
  if (isLoading) return "loading";
  return isError ? "error" : "ready";
}

/** The source is still loading, or does not exist. */
function SourceUnavailable({
  pending,
  onOpenDataSources,
}: {
  pending: boolean;
  onOpenDataSources: () => void;
}) {
  if (pending) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading data source…</p>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Data source not found</h2>
        <p className="mt-2 text-sm text-neutral-fg-subtle">
          The data source you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button
          label="Go to Data Sources"
          onClick={onOpenDataSources}
          className="mt-4"
        />
      </div>
    </div>
  );
}

/**
 * The centre when no table is open: tables still loading or failed, or a
 * source with none yet — one heading, one line, one way forward.
 */
function NoTableCentre({
  tablesStatus,
  sourceId,
  sourceType,
  isFileSource,
  importAction,
  onImported,
  onImportingChange,
  onOpenDataSources,
}: {
  tablesStatus: TablesStatus;
  sourceId: UUID;
  sourceType: string;
  isFileSource: boolean;
  importAction: React.ReactNode;
  onImported: (tableId: UUID) => void;
  onImportingChange: (importing: boolean) => void;
  onOpenDataSources: () => void;
}) {
  if (tablesStatus === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading tables…</p>
      </div>
    );
  }
  if (tablesStatus === "error") {
    return (
      <CentreMessage
        role="alert"
        title="Couldn't load tables"
        line="Something went wrong. Check your connection and try again."
      />
    );
  }
  // Keyed on the stored type, not the registry entry: the registry hydrates
  // asynchronously and would briefly render the generic state for GA4.
  if (sourceType === "googleAnalytics") {
    return (
      <Ga4PropertyPicker
        key={sourceId}
        sourceId={sourceId}
        onImported={onImported}
        onImportingChange={onImportingChange}
        onOpenDataSources={onOpenDataSources}
      />
    );
  }
  if (importAction) {
    return (
      <CentreMessage
        title="No tables yet"
        line={
          isFileSource
            ? "Import a CSV, Excel, or JSON file to add a table."
            : "Choose what to import from this source."
        }
        action={importAction}
      />
    );
  }
  return (
    <CentreMessage
      title="No tables yet"
      line="Choose tables from Add Source on the Data Sources page."
      action={
        <Button
          variant="outline"
          label="Go to Data Sources"
          onClick={onOpenDataSources}
        />
      }
    />
  );
}

/** Above the grid: find a column, the table's size, and grid or list. */
function TableToolbar({
  columnQuery,
  onColumnQueryChange,
  rowCount,
  columnCount,
  view,
  onViewChange,
}: {
  columnQuery: string;
  onColumnQueryChange: (query: string) => void;
  rowCount: number | undefined;
  columnCount: number;
  view: TablePreviewView;
  onViewChange: (view: TablePreviewView) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 pb-2">
      <div className="relative w-56 max-w-full min-w-0">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-fg-subtle"
        />
        <Input
          size="sm"
          aria-label="Find column"
          placeholder="Find column"
          value={columnQuery}
          onChange={(event) => onColumnQueryChange(event.target.value)}
          className="pl-7"
        />
      </div>
      <span className="min-w-0 flex-1 truncate text-xs text-neutral-fg-subtle">
        {rowCount === undefined ? "" : `${rowCount.toLocaleString()} rows · `}
        {columnCount} columns
      </span>
      <Toggle
        size="sm"
        value={view}
        onValueChange={onViewChange}
        options={[
          { value: "grid", label: "Grid", icon: <TableIcon aria-hidden /> },
          {
            value: "columns",
            label: "Columns",
            icon: <ListIcon aria-hidden />,
          },
        ]}
      />
    </div>
  );
}

/** The open table's actions in the header; "Start a report" leads. */
function TableActions({
  table,
  importAction,
  canRefresh,
  isStartingReport,
  onStartReport,
  onDelete,
}: {
  table: DataTable;
  importAction: React.ReactNode;
  canRefresh: boolean;
  isStartingReport: boolean;
  onStartReport: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      {importAction}
      {canRefresh && (
        <RefreshTableButton
          key={table.id}
          size="sm"
          tableId={table.id}
          tableName={table.name}
        />
      )}
      <Button
        size="sm"
        icon={DashboardIcon}
        label="Start a report"
        loading={isStartingReport}
        onClick={onStartReport}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              label="More table actions"
              variant="ghost"
              size="sm"
              iconOnly
              icon={MoreIcon}
            />
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={onDelete}
            className="text-palette-danger focus:text-palette-danger"
          >
            <DeleteIcon className="mr-2 h-4 w-4" />
            Delete table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Where "Import" leads: a file for Local Files (it always lands in that
 * source), or another table the remote source offers.
 */
function SourceImportDialog({
  open,
  onClose,
  source,
  isFileSource,
  tables,
  onImported,
  onOpenDataSources,
}: {
  open: boolean;
  onClose: () => void;
  source: DataSource;
  isFileSource: boolean;
  tables: DataTable[];
  onImported: (tableId: UUID) => void;
  onOpenDataSources: () => void;
}) {
  if (isFileSource) {
    return (
      <DataPickerModal
        isOpen={open}
        onClose={onClose}
        title="Import a file"
        showInsights={false}
        showSources={false}
        onTableSelect={(tableId) => {
          onClose();
          onImported(tableId as UUID);
        }}
      />
    );
  }
  if (!isListableRemoteConnector(source.type)) return null;
  return (
    <ImportTablesDialog
      open={open}
      onClose={onClose}
      sourceId={source.id}
      sourceType={source.type}
      importedResourceIds={new Set(tables.map((table) => table.table))}
      onImported={onImported}
      onOpenDataSources={onOpenDataSources}
    />
  );
}

/**
 * The source's name, edited in place in the header. Saved when the field is
 * left; Escape or a failed save puts the saved name back.
 */
function SourceNameInput({
  savedName,
  onRename,
}: {
  savedName: string;
  onRename: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(savedName);
  const [shownSavedName, setShownSavedName] = useState(savedName);
  // A rename from elsewhere replaces what the field shows.
  if (shownSavedName !== savedName) {
    setShownSavedName(savedName);
    setName(savedName);
  }

  const commit = async () => {
    const next = name.trim();
    if (!next || next === savedName) {
      setName(savedName);
      return;
    }
    if (!(await onRename(next))) setName(savedName);
  };

  return (
    <>
      <label className="sr-only" htmlFor="data-source-name">
        Data source name
      </label>
      <input
        id="data-source-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setName(savedName);
            event.currentTarget.blur();
          }
        }}
        placeholder="Untitled source"
        className="min-w-16 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-sm font-semibold text-neutral-fg outline-none placeholder:text-neutral-fg-subtle focus-visible:ring-2 focus-visible:ring-palette-primary"
      />
    </>
  );
}

/** The column inspector, saving its edits to the column's field. */
function FieldInspectorPane({
  tableId,
  field,
  analysis,
  sampleValues,
}: {
  tableId: UUID;
  field: Field;
  analysis?: ColumnAnalysis;
  sampleValues: string[];
}) {
  const commitBatch = useMutation(api.app.commitBatch);
  const updateField = async (updates: Partial<Field>) => {
    try {
      await commitBatch({
        commands: [
          cmd("UpdateField", { nodeId: tableId, fieldId: field.id, updates }),
        ],
      });
      return true;
    } catch {
      return false;
    }
  };

  return (
    <ColumnInspector
      field={field}
      analysis={analysis}
      sampleValues={sampleValues}
      onRename={async (name) => {
        const saved = await updateField({ name });
        if (!saved) toast.error("Failed to rename column");
        return saved;
      }}
      // Confirming a classifier suggestion keeps its reasons; deliberate
      // marking or clearing is recorded as a user decision.
      onSetSensitivity={async (sensitivity, reasons) => {
        if (
          !(await updateField(buildSensitivityUpdate(sensitivity, reasons)))
        ) {
          toast.error("Failed to update column sensitivity");
          return;
        }
        toast.success(SENSITIVITY_TOASTS[sensitivity]);
      }}
    />
  );
}

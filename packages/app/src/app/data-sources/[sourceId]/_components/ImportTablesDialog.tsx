import {
  RemoteResourceList,
  useRemoteResourceImport,
} from "@/components/data-sources/RemoteResourceImport";
import { useHostMutation } from "@/data/host";
import type { RemoteResource } from "@/lib/remote-connector-onboarding";
import type { UUID } from "@dashframe/types";
import { CONNECTOR_SIGN_IN_EXPIRED } from "@dashframe/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wystack/ui-react";
import { useEffect, useState } from "react";

type ListingState =
  | { status: "loading" }
  | { status: "ready"; resources: RemoteResource[] }
  | { status: "sign-in-expired" }
  | { status: "failed" };

/** Connector kinds that can list more of their tables for an existing source. */
export const LISTABLE_REMOTE_CONNECTORS = [
  "googleAnalytics",
  "notion",
  "postgres",
] as const;
type ListableConnectorId = (typeof LISTABLE_REMOTE_CONNECTORS)[number];

export function isListableRemoteConnector(
  type: string,
): type is ListableConnectorId {
  return (LISTABLE_REMOTE_CONNECTORS as readonly string[]).includes(type);
}

export interface ImportTablesDialogProps {
  open: boolean;
  onClose: () => void;
  sourceId: UUID;
  sourceType: ListableConnectorId;
  /** Resource ids this source already has a table for. */
  importedResourceIds: ReadonlySet<string>;
  onImported: (tableId: UUID) => void;
  /** Where the user can sign in again when the stored grant is unusable. */
  onOpenDataSources: () => void;
}

/**
 * Adds another table from a connected remote source: lists what the source
 * offers that is not a table yet, and imports the chosen one.
 */
export function ImportTablesDialog({
  open,
  onClose,
  ...props
}: ImportTablesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[80vh] max-w-md flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import a table</DialogTitle>
          <DialogDescription>
            Each one becomes a table you can build reports on.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening lists afresh. */}
        {open && <ImportTablesBody {...props} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ImportTablesBody({
  sourceId,
  sourceType,
  importedResourceIds,
  onImported,
  onOpenDataSources,
  onClose,
}: Omit<ImportTablesDialogProps, "open">) {
  const { mutateAsync: listGa4Properties } =
    useHostMutation("listGa4Properties");
  const { mutateAsync: listNotionDatabases } = useHostMutation(
    "listNotionDatabases",
  );
  const { mutateAsync: listPostgresTables } =
    useHostMutation("listPostgresTables");
  const [state, setState] = useState<ListingState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    const list = {
      googleAnalytics: listGa4Properties,
      notion: listNotionDatabases,
      postgres: listPostgresTables,
    }[sourceType];
    list({ dataSourceId: sourceId }).then(
      (resources) => {
        if (current) setState({ status: "ready", resources });
      },
      (cause: unknown) => {
        if (!current) return;
        setState({
          status:
            cause instanceof Error &&
            cause.message === CONNECTOR_SIGN_IN_EXPIRED
              ? "sign-in-expired"
              : "failed",
        });
      },
    );
    return () => {
      // Ignore a response that lands after closing or a retry.
      current = false;
    };
  }, [
    attempt,
    listGa4Properties,
    listNotionDatabases,
    listPostgresTables,
    sourceId,
    sourceType,
  ]);

  const { importResource, importingResourceId, error } =
    useRemoteResourceImport({
      sourceId,
      onImported: (tableId) => {
        onImported(tableId);
        onClose();
      },
    });

  if (state.status === "loading") {
    return <p className="text-sm text-neutral-fg-subtle">Loading…</p>;
  }
  if (state.status === "sign-in-expired") {
    // A sign-in always creates a new source today; the grant of this one
    // cannot be renewed in place, so recovery goes through Add Source.
    return (
      <div role="alert" className="space-y-3">
        <div>
          <p className="text-sm font-medium text-neutral-fg">
            Google sign-in expired.
          </p>
          <p className="mt-1 text-sm text-neutral-fg-subtle">
            Sign in with Google again from Add Source on the Data Sources page.
          </p>
        </div>
        <Button
          variant="outline"
          label="Go to Data Sources"
          onClick={onOpenDataSources}
        />
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <div role="alert" className="space-y-3">
        <div>
          <p className="text-sm font-medium text-neutral-fg">
            Couldn&apos;t load what this source offers.
          </p>
          <p className="mt-1 text-sm text-neutral-fg-subtle">
            Check your connection and try again.
          </p>
        </div>
        <Button
          variant="outline"
          label="Try again"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
        />
      </div>
    );
  }

  // The row being imported keeps its progress even once its table appears.
  const available = state.resources.filter(
    (resource) =>
      !importedResourceIds.has(resource.id) ||
      resource.id === importingResourceId,
  );
  return (
    <div className="min-h-0 overflow-y-auto">
      <RemoteResourceList
        resources={available}
        importingResourceId={importingResourceId}
        onSelect={(resource) => void importResource(resource)}
        error={error}
        emptyMessage="Everything this source offers is already a table here."
      />
    </div>
  );
}

import { useHostMutation } from "@/data/host";
import { makeDefaultCountMetric } from "@/lib/data-access/data-tables";
import type { RemoteResource } from "@/lib/remote-connector-onboarding";
import { api } from "@dashframe/convex-backend/api";
import type { InsightFetchDefinition, UUID } from "@dashframe/types";
import { cmd } from "@dashframe/types";
import { Button } from "@wystack/ui-react";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";

/** A failure whose message is already written for the user. */
export class RemoteImportUserError extends Error {}

const IMPORT_FAILED_MESSAGE =
  "Couldn't fetch this table. Check the connection and try again.";

export async function importRemoteResource(args: {
  sourceId: UUID;
  resource: { id: string; title: string };
  addDataTable: (input: {
    dataSourceId: UUID;
    name: string;
    table: string;
  }) => Promise<{ id: UUID }>;
  prepareRemoteDataTable: (input: { id: UUID }) => Promise<unknown>;
  fetchData: (input: {
    insight: InsightFetchDefinition;
  }) => Promise<{ status: "ready" } | { status: "failed"; message: string }>;
  removeDataTable: (input: { id: UUID }) => Promise<unknown>;
}): Promise<UUID> {
  let tableId: UUID | null = null;
  try {
    tableId = (
      await args.addDataTable({
        dataSourceId: args.sourceId,
        name: args.resource.title,
        table: args.resource.id,
      })
    ).id;
    await args.prepareRemoteDataTable({ id: tableId });
    const result = await args.fetchData({
      insight: { baseTableId: tableId, selectedFields: [], metrics: [] },
    });
    if (result.status === "failed")
      throw new RemoteImportUserError(result.message);
    return tableId;
  } catch (cause) {
    if (tableId) {
      try {
        await args.removeDataTable({ id: tableId });
      } catch (cleanupError) {
        console.error(
          "Failed to clean up remote table onboarding",
          cleanupError,
        );
      }
    }
    throw cause;
  }
}

/**
 * Import one remote resource (a Notion database, Postgres table, or GA4
 * property) of `sourceId` as a DataTable, tracking which row is in flight.
 *
 * `onImported` runs once the table exists; throw `RemoteImportUserError` from it
 * to show its message. Imported resources are remembered locally so a retry
 * never creates a duplicate table before subscriptions catch up.
 */
export function useRemoteResourceImport({
  sourceId,
  onImported,
}: {
  sourceId: UUID | null;
  onImported?: (tableId: UUID, resource: RemoteResource) => unknown;
}) {
  const commitBatch = useMutation(api.app.commitBatch);
  const { mutateAsync: prepareRemoteDataTable } = useHostMutation(
    "prepareRemoteDataTable",
  );
  const { mutateAsync: fetchData } = useHostMutation("fetchData");
  const [importingResourceId, setImportingResourceId] = useState<string | null>(
    null,
  );
  const [failure, setFailure] = useState<{
    sourceId: UUID;
    message: string;
  } | null>(null);
  const [importedKeys, setImportedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const importResource = useCallback(
    async (resource: RemoteResource) => {
      if (!sourceId) return;
      setImportingResourceId(resource.id);
      setFailure(null);
      try {
        const tableId = await importRemoteResource({
          sourceId,
          resource,
          addDataTable: async (input) => {
            const id = crypto.randomUUID() as UUID;
            await commitBatch({
              commands: [
                cmd("CreateDataTable", {
                  id,
                  ...input,
                  metrics: [makeDefaultCountMetric(id)],
                }),
              ],
            });
            return { id };
          },
          prepareRemoteDataTable,
          fetchData,
          removeDataTable: async ({ id }) => {
            await commitBatch({
              commands: [cmd("DeleteNode", { id })],
            });
          },
        });
        // The table now exists even if the follow-up fails. Remove this
        // resource from the choices immediately, before subscriptions catch
        // up, so a retry goes through the existing table instead of creating
        // a duplicate DataTable.
        setImportedKeys((current) => {
          const next = new Set(current);
          next.add(`${sourceId}:${resource.id}`);
          return next;
        });
        await onImported?.(tableId, resource);
      } catch (cause) {
        setFailure({
          sourceId,
          message:
            cause instanceof RemoteImportUserError
              ? cause.message
              : IMPORT_FAILED_MESSAGE,
        });
      } finally {
        setImportingResourceId(null);
      }
    },
    [commitBatch, fetchData, onImported, prepareRemoteDataTable, sourceId],
  );

  const isImported = useCallback(
    (resourceId: string) => importedKeys.has(`${sourceId}:${resourceId}`),
    [importedKeys, sourceId],
  );

  return {
    importResource,
    importingResourceId,
    error: failure?.sourceId === sourceId ? failure.message : null,
    isImported,
  };
}

/** One button per remote resource; the row being imported shows progress. */
export function RemoteResourceList({
  resources,
  importingResourceId,
  onSelect,
  error,
  emptyMessage,
}: {
  resources: RemoteResource[];
  importingResourceId: string | null;
  onSelect: (resource: RemoteResource) => void;
  error?: string | null;
  emptyMessage: string;
}) {
  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-palette-danger">
          {error}
        </p>
      )}
      {resources.length === 0 ? (
        <p className="text-sm text-neutral-fg-subtle">{emptyMessage}</p>
      ) : (
        resources.map((resource) => (
          <Button
            key={resource.id}
            label={resource.title}
            variant="outline"
            className="w-full justify-start"
            loading={importingResourceId === resource.id}
            disabled={importingResourceId !== null}
            onClick={() => onSelect(resource)}
          />
        ))
      )}
    </div>
  );
}

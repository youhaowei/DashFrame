import { useHostMutation } from "@/data/host";
import type { RemoteResource } from "@/lib/remote-connector-onboarding";
import type { UUID } from "@dashframe/types";
import { CONNECTOR_SIGN_IN_EXPIRED } from "@dashframe/types";
import { Button } from "@wystack/ui-react";
import { useEffect, useState } from "react";
import {
  RemoteResourceList,
  useRemoteResourceImport,
} from "./RemoteResourceImport";

type PropertiesState =
  | { status: "loading" }
  | { status: "ready"; properties: RemoteResource[] }
  | { status: "sign-in-expired" }
  | { status: "failed" };

export interface Ga4PropertyPickerProps {
  sourceId: UUID;
  /** Called with the new table once a property has been imported. */
  onImported: (tableId: UUID) => void;
  /**
   * True while an import runs. The table exists (and may be removed again on
   * failure) before the import settles, so the page must keep this picker
   * mounted until then or the row progress and any error are lost.
   */
  onImportingChange: (importing: boolean) => void;
  /** Where the user can sign in with Google again. */
  onOpenDataSources: () => void;
}

/**
 * First-property picker for a connected Google Analytics source with no
 * tables yet — e.g. when the Add Source dialog closed before its property
 * step. Lists the account's properties and imports the chosen one as a table.
 */
export function Ga4PropertyPicker({
  sourceId,
  onImported,
  onImportingChange,
  onOpenDataSources,
}: Ga4PropertyPickerProps) {
  const { mutateAsync: listGa4Properties } =
    useHostMutation("listGa4Properties");
  const [state, setState] = useState<PropertiesState>({ status: "loading" });
  // Bumped by "Try again"; each value is one listing request.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    listGa4Properties({ dataSourceId: sourceId }).then(
      (properties) => {
        if (current) setState({ status: "ready", properties });
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
      // Ignore a response that lands after unmount, a source switch, or a retry.
      current = false;
    };
  }, [attempt, listGa4Properties, sourceId]);

  const { importResource, importingResourceId, error, isImported } =
    useRemoteResourceImport({
      sourceId,
      onImported: (tableId) => onImported(tableId),
    });

  let body;
  if (state.status === "loading") {
    body = (
      <p className="text-sm text-neutral-fg-subtle">
        Loading your Google Analytics properties…
      </p>
    );
  } else if (state.status === "sign-in-expired") {
    // Google sign-in always creates a new source today; there is no way to
    // renew the grant of this one in place, so recovery goes through Add
    // Source.
    body = (
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
  } else if (state.status === "failed") {
    body = (
      <div role="alert" className="space-y-3">
        <div>
          <p className="text-sm font-medium text-neutral-fg">
            Couldn&apos;t load your Google Analytics properties.
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
  } else {
    body = (
      <RemoteResourceList
        resources={state.properties}
        // An imported property keeps its progress until the page swaps this
        // picker for the new table, so it can't be imported twice meanwhile.
        importingResourceId={
          importingResourceId ??
          state.properties.find((property) => isImported(property.id))?.id ??
          null
        }
        onSelect={async (property) => {
          onImportingChange(true);
          try {
            await importResource(property);
          } finally {
            onImportingChange(false);
          }
        }}
        error={error}
        emptyMessage="This Google account has no Google Analytics properties."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-4 sm:p-6 sm:pt-16">
      <div>
        <h2 className="text-lg font-semibold">Choose a property to import</h2>
        <p className="mt-1 text-sm text-neutral-fg-subtle">
          Each property becomes a table you can build reports on.
        </p>
      </div>
      {body}
    </div>
  );
}

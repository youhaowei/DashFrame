import { queryStatus } from "@/data/query-status";
import { clearAllData } from "@/lib/data-access/data-frames";
import { reloadRootWithFreshWorkspaceState } from "@/lib/clear-all-data-navigation";
import { usePlatform } from "@/lib/platform";
import { projectFolderRevealer } from "@/lib/project-folder";
import { useToastStore } from "@/lib/stores";
import { api } from "@dashframe/convex-backend/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@wystack/ui-react";
import { DeleteIcon } from "@wystack/ui-react/icons";
import { useQuery_experimental as useQuery } from "convex/react";
import { useState } from "react";

import {
  SettingsField,
  SettingsLoadError,
  SettingsSection,
} from "./SettingsSection";

/**
 * The open project: its name, where the host serving it is, and, on desktop,
 * its folder. The folder's path never reaches the renderer, so it is offered
 * as an action rather than shown. Clearing the project's data sits last.
 */
export function ProjectSection({ hostUrl }: { hostUrl: string | undefined }) {
  const { data: project, isError: projectFailed } = queryStatus(
    useQuery({ query: api.app.projectInfo, args: {} }),
  );
  const { isMacOS } = usePlatform();
  const [revealFolder] = useState(projectFolderRevealer);
  const { showError } = useToastStore();

  return (
    <SettingsSection
      id="project"
      title="Project"
      description="The project open here and the host that serves it."
    >
      <div className="flex flex-col gap-4">
        {/* A Convex subscription retries by itself; there is no retry to offer. */}
        {projectFailed && (
          <SettingsLoadError message="Couldn't load project details." />
        )}
        {project && (
          <SettingsField label="Name">
            <span className="text-sm text-neutral-fg">{project.name}</span>
          </SettingsField>
        )}
        {revealFolder && (
          <SettingsField label="Project folder">
            <Button
              variant="outline"
              color="secondary"
              size="sm"
              label={isMacOS ? "Show in Finder" : "Show in folder"}
              onClick={() =>
                revealFolder().catch(() =>
                  showError("Couldn't open the project folder"),
                )
              }
              className="self-start"
            />
          </SettingsField>
        )}
        {hostUrl && (
          <SettingsField label="Host">
            <span className="font-mono text-xs break-all text-neutral-fg">
              {hostUrl}
            </span>
          </SettingsField>
        )}
        <ClearAllDataRow />
      </div>
    </SettingsSection>
  );
}

function ClearAllDataRow() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { showError, showSuccess } = useToastStore();

  const handleClearAllData = async () => {
    setClearing(true);
    try {
      await clearAllData();
      setConfirmOpen(false);
      showSuccess("All data cleared");
      reloadRootWithFreshWorkspaceState();
    } catch (error) {
      // The host's own message is for diagnosis, not for the page.
      console.error("Clear all data failed", error);
      showError("Failed to clear data", {
        description: "Try again. If it keeps failing, check the host logs.",
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-3 shadow-[0_-1px_0_var(--neutral-border-subtle)]">
      <div className="min-w-0 flex-1 basis-60">
        <div className="text-sm font-medium text-neutral-fg">
          Clear all data
        </div>
        <p className="text-xs text-neutral-fg-subtle">
          Permanently deletes every data source, insight, chart, report, and
          draft in this project.
        </p>
      </div>
      <Button
        variant="ghost"
        color="danger"
        size="sm"
        icon={DeleteIcon}
        label="Clear all data…"
        onClick={() => setConfirmOpen(true)}
      />
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all data?</DialogTitle>
            <DialogDescription>
              This permanently deletes every data source, insight, chart,
              report, and draft in this project. It can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              label="Cancel"
              onClick={() => setConfirmOpen(false)}
            />
            <Button
              color="danger"
              label="Clear all data"
              disabled={clearing}
              onClick={handleClearAllData}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

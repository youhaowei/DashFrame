import { DataPickerModal } from "./DataPickerModal";

interface AddDataSourceModalProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Called when the dialog should close */
  onClose: () => void;
}

/**
 * "Add Data Source" dialog for the Data Sources page.
 *
 * Shares the data picker's connector onboarding — the connector list, card
 * forms, file ingest, and the remote "choose data to import" step — but not
 * its pick-existing sections: adding a source creates the source and,
 * when it has importable data, its first table, so a finished setup just closes the dialog and the
 * new source appears on the page the user started from.
 */
export function AddDataSourceModal({
  isOpen,
  onClose,
}: AddDataSourceModalProps) {
  return (
    <DataPickerModal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Data Source"
      onTableSelect={onClose}
      showSources={false}
    />
  );
}

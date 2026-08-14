import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCommitBatch } = vi.hoisted(() => ({
  mockCommitBatch: vi.fn(),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => {
      if (ref._path === "listDataSources") {
        return {
          data: [
            {
              id: "source-1",
              name: "Orders CSV",
              type: "local",
              config: {},
            },
          ],
        };
      }
      return { data: [] };
    },
    useMutation: (ref: { _path: string }) => ({
      mutateAsync: ref._path === "commitBatch" ? mockCommitBatch : vi.fn(),
    }),
  };
});

vi.mock("@/lib/connectors/registry", () => ({ getConnectorById: () => null }));
vi.mock("@wystack/ui-react", () => ({
  Button: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
  Collapsible: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  Panel: ({
    children,
    footer,
  }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
  Spinner: () => null,
  Surface: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@dashframe/ui", () => ({ InputField: () => null }));
vi.mock("@wystack/ui-react/icons", () => ({
  ChevronDownIcon: () => null,
  DatabaseIcon: () => null,
  DeleteIcon: () => null,
  PlusIcon: () => null,
  RefreshIcon: () => null,
}));

import { useConfirmDialogStore } from "@/lib/stores";
import { ConfirmDialog } from "../confirm-dialog";
import { DataSourceControls } from "./DataSourceControls";

describe("DataSourceControls delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockCommitBatch.mockResolvedValue({ ok: true });
  });

  it("does not remove a data source after cancellation, but removes it after confirmation", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DataSourceControls dataSourceId="source-1" />
        <ConfirmDialog />
      </>,
    );
    await user.click(
      screen.getByRole("button", { name: "Delete Data Source" }),
    );

    expect(screen.getByRole("dialog").textContent).toContain(
      "This deletes the data source and its data tables. Related DataFrame metadata and storage, and dependent insights, may remain. This action cannot be undone.",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCommitBatch).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Delete Data Source" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: [{ path: "deleteNode", args: { id: "source-1" } }],
      }),
    );
  });
});

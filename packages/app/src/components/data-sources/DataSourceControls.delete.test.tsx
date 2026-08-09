import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRemoveDataSource } = vi.hoisted(() => ({
  mockRemoveDataSource: vi.fn(),
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
      mutateAsync:
        ref._path === "removeDataSource" ? mockRemoveDataSource : vi.fn(),
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
import { DataSourceControls } from "./DataSourceControls";

describe("DataSourceControls delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockRemoveDataSource.mockResolvedValue({ ok: true });
  });

  it("does not remove a data source after cancellation, but removes it after confirmation", () => {
    render(<DataSourceControls dataSourceId="source-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Data Source" }));

    expect(useConfirmDialogStore.getState().config?.description).toContain(
      "This deletes the data source and its data tables. Related DataFrame metadata and storage, and dependent insights, may remain. This action cannot be undone.",
    );
    useConfirmDialogStore.getState().handleCancel();
    expect(mockRemoveDataSource).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Data Source" }));
    useConfirmDialogStore.getState().handleConfirm();
    expect(mockRemoveDataSource).toHaveBeenCalledWith({ id: "source-1" });
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { UUID } from "@dashframe/types";
import { expect, it, vi } from "vite-plus/test";
import { RefreshTableButton } from "./RefreshTableButton";

const { fetchData, success } = vi.hoisted(() => ({
  fetchData: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/data/host", () => ({
  useHostMutation: () => ({ mutateAsync: fetchData }),
}));
vi.mock("sonner", () => ({ toast: { success, error: vi.fn() } }));
vi.mock("@wystack/ui-react/icons", () => ({ RefreshIcon: () => null }));
vi.mock("@wystack/ui-react", () => ({
  Button: ({
    label,
    disabled,
    onClick,
  }: {
    label: string;
    disabled: boolean;
    onClick: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  ),
}));

it("keeps pending work and completion attached to the original table after selection changes", async () => {
  let complete!: (result: { status: "ready" }) => void;
  fetchData.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const { rerender } = render(
    <RefreshTableButton key="a" tableId={"a" as UUID} tableName="Orders" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh", exact: true }));
  expect(
    screen
      .getByRole("button", { name: "Refreshing…" })
      .hasAttribute("disabled"),
  ).toBe(true);
  rerender(
    <RefreshTableButton key="b" tableId={"b" as UUID} tableName="Customers" />,
  );
  expect(
    screen
      .getByRole("button", { name: "Refresh", exact: true })
      .hasAttribute("disabled"),
  ).toBe(false);
  await act(async () => {
    complete({ status: "ready" });
  });
  expect(success).toHaveBeenCalledWith("Orders refreshed");
  expect(success).not.toHaveBeenCalledWith("Customers refreshed");
  expect(fetchData).toHaveBeenCalledExactlyOnceWith({
    insight: { baseTableId: "a", selectedFields: [], metrics: [] },
  });
});

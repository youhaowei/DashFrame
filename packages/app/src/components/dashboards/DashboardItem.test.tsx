import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => {}),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  };
});

import { DashboardItem } from "./DashboardItem";

const item = {
  id: "markdown",
  type: "markdown" as const,
  content: "Canonical content",
  x: 0,
  y: 0,
  width: 4,
  height: 4,
};

describe("DashboardItem markdown editing", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockClear();
  });

  it("discards an open draft when dashboard editing becomes unavailable", () => {
    const view = render(
      <DashboardItem item={item} dashboardId="dashboard" isEditable />,
    );

    const editButton = view.container
      .querySelector(".lucide-pencil")
      ?.closest("button");
    expect(editButton).not.toBeNull();
    fireEvent.click(editButton as HTMLButtonElement);
    fireEvent.change(screen.getByPlaceholderText("Enter markdown..."), {
      target: { value: "Unsaved draft" },
    });

    view.rerender(
      <DashboardItem item={item} dashboardId="dashboard" isEditable={false} />,
    );

    expect(screen.queryByPlaceholderText("Enter markdown...")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Canonical content")).toBeDefined();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    view.rerender(
      <DashboardItem item={item} dashboardId="dashboard" isEditable />,
    );

    expect(screen.queryByPlaceholderText("Enter markdown...")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Canonical content")).toBeDefined();
  });
});

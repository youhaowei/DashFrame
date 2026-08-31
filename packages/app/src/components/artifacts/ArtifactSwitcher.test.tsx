import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ArtifactSwitcher, type ArtifactSwitchItem } from "./ArtifactSwitcher";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const ITEMS: ArtifactSwitchItem[] = [
  {
    id: "orders",
    name: "Orders",
    description: "Order transactions",
    kind: "table",
  },
  {
    id: "customers",
    name: "Customers",
    description: "Customer records",
    kind: "table",
  },
  {
    id: "daily-revenue",
    name: "Daily Revenue",
    description: "Revenue trend",
    kind: "view",
  },
];

function renderSwitcher(onSelect = vi.fn()) {
  const view = render(
    <ArtifactSwitcher
      label="Tables"
      items={ITEMS}
      selectedId="orders"
      onSelect={onSelect}
    />,
  );
  return { onSelect, unmount: view.unmount };
}

describe("ArtifactSwitcher", () => {
  it("filters items by name", () => {
    const { unmount } = renderSwitcher();

    fireEvent.click(screen.getByRole("button", { name: "Tables: Orders" }));
    const search = screen.getByPlaceholderText("Search tables…");

    fireEvent.change(search, { target: { value: "revenue" } });
    expect(screen.getByRole("option", { name: /Daily Revenue/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Orders/ })).toBeNull();
    fireEvent.keyDown(search, { key: "Escape", code: "Escape" });
    unmount();
  });

  it("filters items by type", () => {
    const { unmount } = renderSwitcher();

    fireEvent.click(screen.getByRole("button", { name: "Tables: Orders" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), {
      target: { value: "table" },
    });
    expect(screen.getByRole("option", { name: /Orders/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Customers/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Daily Revenue/ })).toBeNull();
    fireEvent.keyDown(screen.getByPlaceholderText("Search tables…"), {
      key: "Escape",
      code: "Escape",
    });
    unmount();
  });

  it("selects an item with the keyboard and closes with Escape", () => {
    const { onSelect, unmount } = renderSwitcher();

    fireEvent.click(screen.getByRole("button", { name: "Tables: Orders" }));
    const search = screen.getByPlaceholderText("Search tables…");
    fireEvent.change(search, { target: { value: "Customers" } });
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter", code: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("customers");
    expect(screen.queryByPlaceholderText("Search tables…")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tables: Orders" }));
    expect(screen.getByPlaceholderText("Search tables…")).toBeTruthy();
    fireEvent.keyDown(screen.getByPlaceholderText("Search tables…"), {
      key: "Escape",
      code: "Escape",
    });
    expect(screen.queryByPlaceholderText("Search tables…")).toBeNull();
    unmount();
  });

  it("shows an empty state when no item matches the search", () => {
    const { unmount } = renderSwitcher();

    fireEvent.click(screen.getByRole("button", { name: "Tables: Orders" }));
    fireEvent.change(screen.getByPlaceholderText("Search tables…"), {
      target: { value: "not-a-table" },
    });

    expect(screen.getByText("No matching tables.")).toBeTruthy();
    fireEvent.keyDown(screen.getByPlaceholderText("Search tables…"), {
      key: "Escape",
      code: "Escape",
    });
    unmount();
  });
});

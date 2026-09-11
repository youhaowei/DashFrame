import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SortSection } from "./SortSection";

const field = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Created at",
  columnName: "created_at",
  displayName: "Created at",
  type: "date",
  sourceTableId: "table-1",
} as CombinedField;

describe("SortSection", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  it("flips an ascending sort to descending from its direction button", () => {
    const onChange = vi.fn();
    render(
      <SortSection
        sorts={[{ field: "created_at", direction: "asc" }]}
        fields={[field]}
        metrics={[]}
        onChange={onChange}
        onRuntimeChange={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Ascending; switch to descending",
      }),
    );
    expect(onChange).toHaveBeenCalledWith([
      { field: "created_at", direction: "desc" },
    ]);
  });

  it("does not offer another sort when all result columns are used", () => {
    render(
      <SortSection
        sorts={[{ field: "created_at", direction: "asc" }]}
        fields={[field]}
        metrics={[]}
        onChange={vi.fn()}
        onRuntimeChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add sort" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("selects an add-sort command", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        onChange={onChange}
        onRuntimeChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add sort" }));
    await user.click(await screen.findByRole("option", { name: /Created at/ }));
    expect(onChange).toHaveBeenCalledWith([
      { field: "created_at", direction: "asc" },
    ]);
  });

  it("starts viewer sort with no allowed columns and opts fields in", () => {
    const onRuntimeChange = vi.fn();
    render(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        onChange={vi.fn()}
        onRuntimeChange={onRuntimeChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "Viewers can change sort" }),
    );
    expect(onRuntimeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Created at" }));
    expect(onRuntimeChange).toHaveBeenCalledWith({
      sort: { allowedFieldIds: [field.id], maxKeys: 1 },
    });
  });

  it("keeps an empty enabled sort local when another control changes", () => {
    const onRuntimeChange = vi.fn();
    const view = render(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        runtimeControls={{
          sort: { allowedFieldIds: [field.id], maxKeys: 1 },
        }}
        onChange={vi.fn()}
        onRuntimeChange={onRuntimeChange}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Created at" }));
    expect(onRuntimeChange).toHaveBeenCalledWith(undefined);

    view.rerender(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        runtimeControls={{
          filters: [{ filterId: "region", key: "region", label: "Region" }],
        }}
        onChange={vi.fn()}
        onRuntimeChange={onRuntimeChange}
      />,
    );

    expect(
      (
        screen.getByRole("switch", {
          name: "Viewers can change sort",
        }) as HTMLButtonElement
      ).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Created at",
        }) as HTMLButtonElement
      ).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("commits valid viewer limits on blur rather than each keystroke", () => {
    const onRuntimeChange = vi.fn();
    render(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        runtimeControls={{ limit: { min: 1, max: 1000 } }}
        onChange={vi.fn()}
        onRuntimeChange={onRuntimeChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Minimum"), {
      target: { value: "10" },
    });
    expect(onRuntimeChange).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByLabelText("Minimum"));
    expect(onRuntimeChange).toHaveBeenCalledWith({
      limit: { min: 10, max: 1000 },
    });
  });

  it("preserves a pending sort declaration when limit is toggled immediately", async () => {
    let resolveFirst = (_value?: boolean) => undefined;
    const firstWrite = new Promise<boolean | void>((resolve) => {
      resolveFirst = resolve;
    });
    const onRuntimeChange = vi
      .fn()
      .mockReturnValueOnce(firstWrite)
      .mockResolvedValueOnce(true);
    render(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        onChange={vi.fn()}
        onRuntimeChange={onRuntimeChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Viewers can change sort" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Created at" }));
    fireEvent.click(
      screen.getByRole("switch", { name: "Viewers can set a limit" }),
    );

    expect(onRuntimeChange).toHaveBeenNthCalledWith(2, {
      sort: { allowedFieldIds: [field.id], maxKeys: 1 },
      limit: { min: 1, max: 1000 },
    });
    resolveFirst(true);
  });

  it("accepts a reordered server echo before composing a later sort write", () => {
    const onRuntimeChange = vi.fn().mockResolvedValue(true);
    const region = { filterId: "region", key: "region", label: "Region" };
    const period = { filterId: "period", key: "period", label: "Period" };
    const view = render(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        runtimeControls={{ filters: [region] }}
        onChange={vi.fn()}
        onRuntimeChange={onRuntimeChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Viewers can set a limit" }),
    );
    view.rerender(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        runtimeControls={{
          limit: { max: 1000, min: 1 },
          filters: [region],
        }}
        onChange={vi.fn()}
        onRuntimeChange={onRuntimeChange}
      />,
    );
    view.rerender(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        runtimeControls={{
          filters: [region, period],
          limit: { min: 1, max: 1000 },
        }}
        onChange={vi.fn()}
        onRuntimeChange={onRuntimeChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Viewers can change sort" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Created at" }));
    expect(onRuntimeChange).toHaveBeenLastCalledWith({
      filters: [region, period],
      limit: { min: 1, max: 1000 },
      sort: { allowedFieldIds: [field.id], maxKeys: 1 },
    });
  });
});

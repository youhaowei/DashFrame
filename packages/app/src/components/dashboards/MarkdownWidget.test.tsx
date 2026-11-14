import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { MarkdownWidget } from "./MarkdownWidget";

function widget(content: string, isEditing: boolean) {
  return (
    <MarkdownWidget
      content={content}
      isEditing={isEditing}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

describe("MarkdownWidget", () => {
  it("preserves an in-progress draft when content changes externally", () => {
    const { rerender } = render(widget("Initial content", true));

    const editor = screen.getByPlaceholderText("Enter markdown...");
    fireEvent.change(editor, { target: { value: "My draft" } });

    rerender(widget("External update", true));

    expect(editor).toHaveProperty("value", "My draft");
  });

  it("syncs external content changes while not editing", () => {
    const { rerender } = render(widget("Initial content", false));

    expect(screen.getByText("Initial content")).toBeDefined();

    rerender(widget("External update", false));

    expect(screen.getByText("External update")).toBeDefined();

    rerender(widget("External update", true));

    expect(screen.getByPlaceholderText("Enter markdown...")).toHaveProperty(
      "value",
      "External update",
    );
  });

  it("discards an abandoned draft when edit mode exits", () => {
    const { rerender } = render(widget("Initial content", true));

    fireEvent.change(screen.getByPlaceholderText("Enter markdown..."), {
      target: { value: "Abandoned draft" },
    });

    // External update lands mid-edit, then the parent leaves edit mode without
    // saving: the buffer must resync to the latest content, not resurrect the
    // draft the next time the editor opens.
    rerender(widget("External update", true));
    rerender(widget("External update", false));
    rerender(widget("External update", true));

    expect(screen.getByPlaceholderText("Enter markdown...")).toHaveProperty(
      "value",
      "External update",
    );
  });

  it("saves the draft and resets it when cancelled", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <MarkdownWidget
        content="Initial content"
        isEditing
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    const editor = screen.getByPlaceholderText("Enter markdown...");
    fireEvent.change(editor, { target: { value: "Saved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith("Saved draft");

    fireEvent.change(editor, { target: { value: "Discarded draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(editor).toHaveProperty("value", "Initial content");
  });
});

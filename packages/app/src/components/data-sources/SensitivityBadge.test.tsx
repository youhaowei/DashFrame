import type { Field } from "@dashframe/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SensitivityBadge } from "./SensitivityBadge";

const field = {
  id: "field-1",
  name: "Email",
  tableId: "table-1",
  type: "string",
} as unknown as Field;

describe("SensitivityBadge", () => {
  it("ignores repeated confirmation keys while handling the initial keydown", () => {
    const onConfirmSuggestion = vi.fn();

    render(
      <SensitivityBadge
        field={field}
        suggestedReasons={["Contains email addresses"]}
        onConfirmSuggestion={onConfirmSuggestion}
      />,
    );

    const badge = screen.getByRole("button", { name: "Likely sensitive" });
    fireEvent.keyDown(badge, { key: "Enter", repeat: true });
    expect(onConfirmSuggestion).not.toHaveBeenCalled();

    fireEvent.keyDown(badge, { key: "Enter" });
    expect(onConfirmSuggestion).toHaveBeenCalledTimes(1);
  });
});

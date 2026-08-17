import type { Field } from "@dashframe/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { SensitivityBadge } from "./SensitivityBadge";

const field = {
  id: "field-1",
  name: "Email",
  tableId: "table-1",
  type: "string",
} as unknown as Field;

describe("SensitivityBadge", () => {
  it.each(["Enter", " "])(
    "confirms once on %j and ignores auto-repeat",
    (key) => {
      const onConfirmSuggestion = vi.fn();

      render(
        <SensitivityBadge
          field={field}
          suggestedReasons={["Contains email addresses"]}
          onConfirmSuggestion={onConfirmSuggestion}
        />,
      );

      const badge = screen.getByRole("button", { name: "Likely sensitive" });

      fireEvent.keyDown(badge, { key });
      expect(onConfirmSuggestion).toHaveBeenCalledTimes(1);

      // Holding the key must not confirm again, but the default action stays
      // suppressed so a held Space cannot scroll the page.
      const repeated = fireEvent.keyDown(badge, { key, repeat: true });
      expect(onConfirmSuggestion).toHaveBeenCalledTimes(1);
      expect(repeated).toBe(false);
    },
  );
});

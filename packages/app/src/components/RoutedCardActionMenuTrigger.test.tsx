import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@wystack/ui-react";
import { describe, expect, it, vi } from "vitest";
import { RoutedCardActionMenuTrigger } from "./RoutedCardActionMenuTrigger";

function renderRoutedCardMenu(onNavigate = vi.fn()) {
  render(
    <div onClick={onNavigate}>
      <DropdownMenu>
        <RoutedCardActionMenuTrigger />
        <DropdownMenuContent>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>,
  );

  return {
    action: screen.getByRole("button", { name: "More options" }),
    onNavigate,
  };
}

describe("RoutedCardActionMenuTrigger", () => {
  it.each(["pointer", "Enter", "Space"] as const)(
    "opens with %s after a completed activation without navigating the card",
    async (activation) => {
      const user = userEvent.setup();
      const { action, onNavigate } = renderRoutedCardMenu();

      if (activation === "pointer") {
        await user.click(action);
      } else {
        action.focus();
        await user.keyboard(activation === "Enter" ? "{Enter}" : "[Space]");
      }

      const deleteItem = await screen.findByRole("menuitem", {
        name: "Delete",
      });
      expect(action.getAttribute("aria-expanded")).toBe("true");
      if (activation !== "pointer") {
        expect(document.activeElement).toBe(deleteItem);
      }
      expect(onNavigate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: "Enter", key: "Enter" },
    { name: "Space", key: " " },
  ] as const)(
    "suppresses repeated $name keydown through the completed key release",
    ({ key }) => {
      const { action, onNavigate } = renderRoutedCardMenu();
      const click = vi.spyOn(action, "click");

      action.focus();
      fireEvent.keyDown(action, { key, repeat: true });
      fireEvent.keyUp(action, { key });

      expect(click).not.toHaveBeenCalled();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
      expect(document.activeElement).toBe(action);
      expect(onNavigate).not.toHaveBeenCalled();
    },
  );
});

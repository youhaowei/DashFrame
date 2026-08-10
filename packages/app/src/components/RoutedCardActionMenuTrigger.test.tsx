import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@wystack/ui-react";
import { describe, expect, it, vi } from "vitest";
import { RoutedCardActionMenuTrigger } from "./RoutedCardActionMenuTrigger";

function renderRoutedCardMenu(onNavigate = vi.fn(), onOpen = vi.fn()) {
  render(
    <div onClick={onNavigate}>
      <DropdownMenu>
        <RoutedCardActionMenuTrigger />
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onOpen}>Open</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>,
  );

  return {
    action: screen.getByRole("button", { name: "More options" }),
    onNavigate,
    onOpen,
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

      const openItem = await screen.findByRole("menuitem", {
        name: "Open",
      });
      expect(action.getAttribute("aria-expanded")).toBe("true");
      if (activation !== "pointer") {
        expect(document.activeElement).toBe(openItem);
      }
      expect(onNavigate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: "Enter", key: "Enter" },
    { name: "Space", key: " " },
  ] as const)(
    "keeps the menu closed through held $name repeats and opens once on keyup",
    async ({ key }) => {
      const { action, onNavigate, onOpen } = renderRoutedCardMenu();
      const click = vi.spyOn(action, "click");

      action.focus();
      fireEvent.keyDown(action, { key });
      fireEvent.keyDown(action, { key, repeat: true });
      fireEvent.keyDown(action, { key, repeat: true });

      expect(click).not.toHaveBeenCalled();
      expect(screen.queryByRole("menuitem", { name: "Open" })).toBeNull();
      expect(document.activeElement).toBe(action);
      expect(onOpen).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();

      fireEvent.keyUp(action, { key });

      const openItem = await screen.findByRole("menuitem", { name: "Open" });
      expect(click).toHaveBeenCalledTimes(1);
      expect(action.getAttribute("aria-expanded")).toBe("true");
      await waitFor(() => expect(document.activeElement).toBe(openItem));
      expect(onOpen).not.toHaveBeenCalled();
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

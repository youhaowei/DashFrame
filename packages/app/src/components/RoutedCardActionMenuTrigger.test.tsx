import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@wystack/ui-react";
import { describe, expect, it, vi } from "vite-plus/test";
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

  it("keeps the menu closed through held Enter repeats and opens once on keyup", async () => {
    const { action, onNavigate, onOpen } = renderRoutedCardMenu();
    const click = vi.spyOn(action, "click");

    action.focus();
    fireEvent.keyDown(action, { key: "Enter" });
    fireEvent.keyDown(action, { key: "Enter", repeat: true });
    fireEvent.keyDown(action, { key: "Enter", repeat: true });

    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem", { name: "Open" })).toBeNull();
    expect(document.activeElement).toBe(action);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.keyUp(action, { key: "Enter" });

    const openItem = await screen.findByRole("menuitem", { name: "Open" });
    expect(click).toHaveBeenCalledTimes(1);
    expect(action.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(openItem));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("suppresses repeated Enter keydown through the completed key release", () => {
    const { action, onNavigate } = renderRoutedCardMenu();
    const click = vi.spyOn(action, "click");

    action.focus();
    fireEvent.keyDown(action, { key: "Enter", repeat: true });
    fireEvent.keyUp(action, { key: "Enter" });

    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(document.activeElement).toBe(action);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

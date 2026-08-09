import { groupHoverAndFocusWithinReveal } from "@dashframe/ui";
import { ButtonPrimitive, DropdownMenuTrigger } from "@wystack/ui-react";
import { MoreIcon } from "@wystack/ui-react/icons";
import type { KeyboardEvent, MouseEvent } from "react";

function handleClick(event: MouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "Enter" && event.key !== " ") return;

  // Base UI opens Menu.Trigger on mousedown, while native keyboard activation
  // dispatches click at different points for Enter and Space. Normalize both to
  // one click on keydown and suppress native Space's keyup click.
  event.preventDefault();
  if (!event.repeat) event.currentTarget.click();
}

/**
 * The action-menu trigger used inside routed cards.
 *
 * Keeps pointer and keyboard activation inside the menu instead of bubbling a
 * synthetic click to the card's navigation handler.
 */
export function RoutedCardActionMenuTrigger() {
  return (
    <DropdownMenuTrigger
      render={
        <ButtonPrimitive
          type="button"
          variant="ghost"
          size="icon"
          aria-label="More options"
          title="More options"
          className={`transition-opacity ${groupHoverAndFocusWithinReveal}`}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          <MoreIcon aria-hidden />
          <span className="sr-only">More options</span>
        </ButtonPrimitive>
      }
    />
  );
}

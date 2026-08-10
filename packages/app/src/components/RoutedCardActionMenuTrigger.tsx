import { groupHoverAndFocusWithinReveal } from "@dashframe/ui";
import { ButtonPrimitive, DropdownMenuTrigger } from "@wystack/ui-react";
import { MoreIcon } from "@wystack/ui-react/icons";
import { useRef, type KeyboardEvent, type MouseEvent } from "react";

function handleClick(event: MouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

/**
 * The action-menu trigger used inside routed cards.
 *
 * Keeps pointer and keyboard activation inside the menu instead of bubbling a
 * synthetic click to the card's navigation handler.
 */
export function RoutedCardActionMenuTrigger() {
  const pendingKeyboardActivation = useRef<"Enter" | " " | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    // Keep the menu closed for the entire key hold. Otherwise Base UI focuses
    // the first item after the initial synthetic click and a repeat can activate
    // that item before the user releases the key.
    event.preventDefault();
    if (!event.repeat) pendingKeyboardActivation.current = event.key;
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    if (pendingKeyboardActivation.current !== event.key) return;

    pendingKeyboardActivation.current = null;
    event.currentTarget.click();
  };

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
          onKeyUp={handleKeyUp}
        >
          <MoreIcon aria-hidden />
          <span className="sr-only">More options</span>
        </ButtonPrimitive>
      }
    />
  );
}

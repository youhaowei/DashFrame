/**
 * Keeps hover-revealed actions visible while keyboard focus is within the
 * containing Tailwind group. The consuming element needs an ancestor carrying
 * Tailwind's `group` class — without one, neither selector ever matches and the
 * action is permanently invisible.
 *
 * Known limit: `:focus-within` only sees the group's own DOM subtree, and
 * dropdown/popover content is portaled out of it. Opening a menu by keyboard
 * therefore moves focus outside the group and fades the trigger back out while
 * the menu stays open. The menu remains operable; only the trigger's visual
 * continuity is affected, and pointer users are unaffected because hover still
 * matches. Fixing it needs an open-state selector on the trigger, not a change
 * here.
 */
export const groupHoverAndFocusWithinReveal =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";

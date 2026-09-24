import { usePlatform } from "@/lib/platform";
import { create } from "zustand";

interface CommandPaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

/** Whether the palette is open. The nav's search row, the top bar and ⌘K all open the same one. */
export const useCommandPalette = create<CommandPaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));

/**
 * What the palette searches first. Unused today: every open searches the whole
 * app. A workbench will supply one ("In this chart") and the palette shows it
 * as a removable chip in the input row.
 */
export interface CommandPaletteScope {
  label: string;
}

interface ShortcutKeys {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** ⌘K on macOS, Ctrl+K elsewhere, with no other modifier. */
export function isCommandPaletteShortcut(
  event: ShortcutKeys,
  isMac: boolean,
): boolean {
  const modifier = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return (
    modifier &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "k"
  );
}

/** The shortcut as the platform writes it, for hints. */
export function useCommandPaletteShortcutLabel(): string {
  const { isMacOS } = usePlatform();
  return isMacOS ? "⌘K" : "Ctrl K";
}

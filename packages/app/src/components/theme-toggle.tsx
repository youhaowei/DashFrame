import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@wystack/ui-react";
import { DarkModeIcon, LightModeIcon } from "@wystack/ui-react/icons";
import { useTheme } from "@wystack/ui-react/theme";
import * as React from "react";

// Subscribe is a no-op: the snapshot transitions from server (false) to
// client (true) once on hydration, which is exactly what we need to defer
// rendering the interactive dropdown until after mount.
const subscribeMounted = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export function ThemeToggle() {
  const { setMode } = useTheme();
  // Defer rendering the interactive dropdown until after mount to avoid
  // Radix ID mismatches between server and client during hydration.
  const mounted = React.useSyncExternalStore(
    subscribeMounted,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        icon={LightModeIcon}
        iconOnly
        label="Toggle theme"
        disabled
        className="h-7 w-7 opacity-50"
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            iconOnly
            label="Toggle theme"
            className="h-7 w-7 text-neutral-fg-subtle hover:text-neutral-fg"
          >
            <LightModeIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
            <DarkModeIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setMode("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode("system")}>
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

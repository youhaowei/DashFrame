"use client";

import * as React from "react";
import {
  LightModeIcon,
  DarkModeIcon,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dashframe/ui";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // Defer rendering the interactive dropdown until after mount to avoid
  // Radix ID mismatches between server and client during hydration.
  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button
        variant="text"
        icon={LightModeIcon}
        iconOnly
        label="Toggle theme"
        disabled
        className="opacity-50"
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="text" iconOnly label="Toggle theme">
          <LightModeIcon className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <DarkModeIcon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import React, { useEffect, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";

interface ThemeWrapperProps {
  children: ReactNode;
  theme: string;
}

export function ThemeWrapper({ children, theme }: ThemeWrapperProps) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");

    if (theme === "system") {
      // Detect system theme
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      forcedTheme={theme === "system" ? undefined : theme}
      enableSystem
    >
      {children}
    </ThemeProvider>
  );
}

import { StduiProvider, useTheme } from "@wystack/ui/theme";
import { useEffect, type ReactNode } from "react";

interface ThemeWrapperProps {
  children?: ReactNode;
  theme: string;
}

function ThemeSetter({ theme }: { theme: string }) {
  const { setMode } = useTheme();

  useEffect(() => {
    setMode(theme as "light" | "dark" | "system");
  }, [theme, setMode]);

  return null;
}

export function ThemeWrapper({ children, theme }: ThemeWrapperProps) {
  return (
    <StduiProvider defaultMode={theme as "light" | "dark" | "system"}>
      <ThemeSetter theme={theme} />
      {children}
    </StduiProvider>
  );
}

import { StduiProvider } from "@wystack/ui/theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <StduiProvider defaultMode="system" storageKey="dashframe">
      {children}
    </StduiProvider>
  );
}

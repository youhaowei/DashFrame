"use client";

import { StduiProvider } from "@dashframe/ui";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <StduiProvider defaultMode="system" storageKey="dashframe">
      {children}
    </StduiProvider>
  );
}

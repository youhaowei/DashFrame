import type { ReactNode } from "react";

export interface DatabaseContextValue {
  isReady: boolean;
  error: Error | null;
}

export function useDatabase(): DatabaseContextValue {
  return { isReady: true, error: null };
}

export function DatabaseProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return children;
}

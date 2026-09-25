import { createContext, useContext, type ReactNode } from "react";

const UsageAnalyticsContext = createContext<string | null>(null);

/**
 * Names the usage-analytics service this build reports to, so the app can say
 * so where it describes what leaves the machine. A host that sends none (the
 * desktop app, a web build without an analytics key) mounts no provider.
 */
export function UsageAnalyticsProvider({
  service,
  children,
}: {
  service: string | null;
  children: ReactNode;
}) {
  return (
    <UsageAnalyticsContext value={service}>{children}</UsageAnalyticsContext>
  );
}

export function useUsageAnalyticsService(): string | null {
  return useContext(UsageAnalyticsContext);
}

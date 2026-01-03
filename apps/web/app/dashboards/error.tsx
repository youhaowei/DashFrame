"use client";

import { useEffect } from "react";
import { Button, DashboardIcon } from "@dashframe/ui";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the dashboards route.
 * Catches and displays errors that occur in dashboard pages.
 */
export default function DashboardsError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("[Dashboards Error]", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="bg-destructive/10 text-destructive mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <DashboardIcon className="h-8 w-8" />
      </div>
      <h2 className="text-foreground mb-2 text-lg font-semibold">
        Something went wrong
      </h2>
      <p className="text-muted-foreground mb-6 max-w-md text-center text-sm">
        An error occurred while loading dashboards. Please try again.
      </p>
      <Button label="Try again" onClick={reset} />
    </div>
  );
}

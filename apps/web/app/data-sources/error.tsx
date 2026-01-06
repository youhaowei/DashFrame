"use client";

import { Button, DatabaseIcon } from "@dashframe/ui";
import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the data-sources route.
 * Catches and displays errors that occur in data source pages.
 */
export default function DataSourcesError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("[Data Sources Error]", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <DatabaseIcon className="h-8 w-8" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Something went wrong
      </h2>
      <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
        An error occurred while loading data sources. Please try again.
      </p>
      <Button label="Try again" onClick={reset} />
    </div>
  );
}

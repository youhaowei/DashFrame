"use client";

import { useEffect } from "react";
import { Button, LightbulbIcon } from "@dashframe/ui";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the insights route.
 * Catches and displays errors that occur in insight pages.
 */
export default function InsightsError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("[Insights Error]", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="bg-destructive/10 text-destructive mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <LightbulbIcon className="h-8 w-8" />
      </div>
      <h2 className="text-foreground mb-2 text-lg font-semibold">
        Something went wrong
      </h2>
      <p className="text-muted-foreground mb-6 max-w-md text-center text-sm">
        An error occurred while loading insights. Please try again.
      </p>
      <Button label="Try again" onClick={reset} />
    </div>
  );
}

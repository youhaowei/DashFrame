"use client";

import { Spinner } from "@dashframe/ui";

/**
 * LoadingView - Centered loading spinner for insight page
 */
export function LoadingView() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading insight...</p>
      </div>
    </div>
  );
}

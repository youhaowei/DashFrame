"use client";

import { LoaderIcon } from "@dashframe/ui/icons";

/**
 * LoadingView - Centered loading spinner for insight page
 */
export function LoadingView() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <LoaderIcon className="text-muted-foreground h-8 w-8 animate-spin" />
        <p className="text-muted-foreground text-sm">Loading insight...</p>
      </div>
    </div>
  );
}

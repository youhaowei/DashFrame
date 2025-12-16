"use client";

import { useRouter } from "next/navigation";
import { Button } from "@dashframe/ui/primitives/button";

interface NotFoundViewProps {
  type: "insight" | "dataTable";
}

/**
 * NotFoundView - Error view when insight or data table is not found
 */
export function NotFoundView({ type }: NotFoundViewProps) {
  const router = useRouter();

  const title =
    type === "insight" ? "Insight not found" : "Data table not found";
  const description =
    type === "insight"
      ? "The insight you're looking for doesn't exist."
      : "The data table for this insight no longer exists.";

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-2 text-sm">{description}</p>
        <Button onClick={() => router.push("/insights")} className="mt-4">
          Go to Insights
        </Button>
      </div>
    </div>
  );
}

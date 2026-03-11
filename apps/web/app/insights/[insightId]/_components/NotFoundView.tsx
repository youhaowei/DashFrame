import { Button } from "@stdui/react";
import { useNavigate } from "@tanstack/react-router";

interface NotFoundViewProps {
  type: "insight" | "dataTable";
}

/**
 * NotFoundView - Error view when insight or data table is not found
 */
export function NotFoundView({ type }: NotFoundViewProps) {
  const navigate = useNavigate();

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
        <p className="mt-2 text-sm text-neutral-fg-subtle">{description}</p>
        <Button
          onClick={() => navigate({ to: "/insights" })}
          className="mt-4"
          label="Go to Insights"
        />
      </div>
    </div>
  );
}

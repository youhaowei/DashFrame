import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { VisualizationItemCard } from "./VisualizationItemCard";

vi.mock("./VisualizationPreview", () => ({
  VisualizationPreview: () => <div data-testid="visualization-preview" />,
}));

const visualization = {
  id: "viz-1",
  name: "Test Chart",
  insightId: "insight-1",
  visualizationType: "bar",
  encoding: { x: "field:category", y: "metric:count" },
  createdAt: 0,
} as unknown as import("@dashframe/types").Visualization;

describe("VisualizationItemCard nested actions", () => {
  function renderCard(onCardClick: ReturnType<typeof vi.fn>) {
    render(
      <VisualizationItemCard
        visualization={visualization}
        onClick={onCardClick}
        actions={[{ label: "Duplicate", onClick: vi.fn() }]}
      />,
    );

    return screen.getByRole("button", { name: "Actions" });
  }

  it("does not activate the parent card when its action trigger is clicked", () => {
    const onCardClick = vi.fn();
    const actionTrigger = renderCard(onCardClick);

    fireEvent.click(actionTrigger);

    expect(onCardClick).not.toHaveBeenCalled();
  });

  it.each(["Enter", " "])(
    "does not activate the parent card when its action trigger receives %s",
    (key) => {
      const onCardClick = vi.fn();
      const actionTrigger = renderCard(onCardClick);

      fireEvent.keyDown(actionTrigger, { key });

      expect(onCardClick).not.toHaveBeenCalled();
    },
  );
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Partial-mock the WyStack client: keep `createApi` real and replace hooks.
vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: () => ({
      data: [{ id: "viz", insightId: "insight", visualizationType: "bar" }],
    }),
    useMutation: () => ({ mutateAsync: vi.fn() }),
  };
});

vi.mock("./VisualizationDisplay", () => ({
  VisualizationDisplay: ({ visualizationId }: { visualizationId: string }) => (
    <div>display:{visualizationId}</div>
  ),
}));

vi.mock("./VisualizationPreview", () => ({
  VisualizationPreview: ({
    visualization,
    height,
  }: {
    visualization: { id: string };
    height?: number | "container";
  }) => (
    <div>
      preview:{visualization.id}:{height}
    </div>
  ),
}));

import { VisualizationRenderer } from "./VisualizationRenderer";

describe("VisualizationRenderer", () => {
  it("delegates full rendering to the canonical insight-aware display", () => {
    render(<VisualizationRenderer visualizationId="viz" />);
    expect(screen.getByText("display:viz")).toBeTruthy();
  });

  it("delegates preview rendering to the canonical insight-aware preview", () => {
    render(<VisualizationRenderer visualizationId="viz" preview />);
    expect(screen.getByText("preview:viz:container")).toBeTruthy();
  });
});

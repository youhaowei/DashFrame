import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

// Keep generated Convex function references while replacing React hooks.
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(() => ({
    data: [{ id: "viz", insightId: "insight", visualizationType: "bar" }],
  })),
  useMutation: nativeMutationMock(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock(() => ({
    data: [{ id: "viz", insightId: "insight", visualizationType: "bar" }],
  })),
  useHostMutation: hostMutationMock(() => ({ mutateAsync: vi.fn() })),
}));

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

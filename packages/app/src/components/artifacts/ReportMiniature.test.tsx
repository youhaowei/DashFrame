import type {
  DashboardControl,
  DashboardItem,
  Visualization,
} from "@dashframe/types";
import { act, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { computeItemOverrides } from "@/lib/dashboards/controls";

import { ReportMiniature } from "./ReportMiniature";

const previewProps = vi.hoisted(() => [] as Record<string, unknown>[]);

// The preview's own behaviour is covered in its tests; here it records the
// props the miniature hands it.
vi.mock("@/components/visualizations/VisualizationPreview", () => ({
  VisualizationPreview: (props: { visualization: Visualization }) => {
    previewProps.push(props);
    return <span data-testid="live-chart">{props.visualization.id}</span>;
  },
}));

let observers: {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
}[] = [];

class FakeIntersectionObserver {
  constructor(
    public callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
    observers.push(this);
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  observers = [];
  previewProps.length = 0;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function scrollIntoView() {
  act(() => {
    for (const observer of observers) {
      observer.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );
    }
  });
}

const chart = (id: string, x: number, y: number, visualizationId = id) =>
  ({
    id,
    type: "visualization",
    visualizationId,
    x,
    y,
    width: 4,
    height: 3,
  }) as const;

const vizMap = (...ids: string[]) =>
  new Map(ids.map((id) => [id, { id } as unknown as Visualization]));

describe("ReportMiniature", () => {
  it("draws an empty report as a dashed frame", () => {
    render(<ReportMiniature items={[]} visualizationById={new Map()} />);

    expect(screen.getByTestId("miniature-empty").className).toContain(
      "border-dashed",
    );
  });

  it("goes live when an empty report gains its first chart", () => {
    const { rerender } = render(
      <ReportMiniature items={[]} visualizationById={vizMap("a")} />,
    );
    rerender(
      <ReportMiniature
        items={[chart("a", 0, 0)]}
        visualizationById={vizMap("a")}
      />,
    );
    scrollIntoView();

    expect(screen.getByTestId("live-chart").textContent).toBe("a");
  });

  it("draws a chart with its cell's overrides and the report's control defaults", () => {
    const item = {
      ...chart("a", 0, 0),
      overrides: {
        sorts: [{ field: "Sales", direction: "desc" as const }],
        limit: 5,
      },
    };
    const control = {
      id: "region",
      field: "Region",
      operator: "eq",
      defaultValue: "West",
      boundInstances: ["a"],
    } as unknown as DashboardControl;
    render(
      <ReportMiniature
        items={[item]}
        visualizationById={vizMap("a")}
        controls={[control]}
      />,
    );
    scrollIntoView();

    expect(previewProps.at(-1)?.overrides).toEqual(
      computeItemOverrides(item as DashboardItem, [control]),
    );
    expect(previewProps.at(-1)?.reportCell).toBe(true);
    expect(previewProps.at(-1)?.overrides).toMatchObject({
      sorts: [{ field: "Sales", direction: "desc" }],
      limit: 5,
      filters: [expect.objectContaining({ field: "Region", value: "West" })],
    });
  });

  it("watches against the scrolling panel that clips the tile", () => {
    const panel = document.createElement("div");
    panel.style.overflowY = "auto";
    document.body.append(panel);
    const tile = panel.appendChild(document.createElement("div"));
    render(
      <ReportMiniature
        items={[chart("a", 0, 0)]}
        visualizationById={vizMap("a")}
      />,
      { container: tile },
    );

    expect(observers.at(-1)?.options).toEqual({
      root: panel,
      rootMargin: "200px",
    });
    panel.remove();
  });

  it("watches against the viewport when nothing scrolls", () => {
    render(
      <ReportMiniature
        items={[chart("a", 0, 0)]}
        visualizationById={vizMap("a")}
      />,
    );

    expect(observers.at(-1)?.options).toEqual({
      root: null,
      rootMargin: "200px",
    });
  });

  it("draws a text block as muted bars, never a chart", () => {
    render(
      <ReportMiniature
        items={[
          { id: "t", type: "markdown", x: 0, y: 0, width: 12, height: 1 },
        ]}
        visualizationById={new Map()}
      />,
    );
    scrollIntoView();

    expect(screen.getByTestId("miniature-text")).toBeTruthy();
    expect(screen.queryByTestId("live-chart")).toBeNull();
  });

  it("mounts live charts only once the tile nears the viewport", () => {
    render(
      <ReportMiniature
        items={[chart("a", 0, 0)]}
        visualizationById={vizMap("a")}
      />,
    );

    expect(screen.queryByTestId("live-chart")).toBeNull();
    scrollIntoView();
    expect(screen.getByTestId("live-chart").textContent).toBe("a");
  });

  it("keeps charts past the cap as placeholders, in reading order", () => {
    // Given out of order: the cap must keep the first two in reading order.
    render(
      <ReportMiniature
        maxLiveCharts={2}
        items={[chart("c", 0, 3), chart("b", 4, 0), chart("a", 0, 0)]}
        visualizationById={vizMap("a", "b", "c")}
      />,
    );
    scrollIntoView();

    expect(
      screen.getAllByTestId("live-chart").map((node) => node.textContent),
    ).toEqual(["a", "b"]);
    expect(screen.getAllByTestId("miniature-chart")).toHaveLength(3);
  });

  it("draws a deleted chart as a muted block without spending the cap", () => {
    render(
      <ReportMiniature
        maxLiveCharts={1}
        items={[chart("gone", 0, 0), chart("a", 4, 0)]}
        visualizationById={vizMap("a")}
      />,
    );
    scrollIntoView();

    expect(screen.getAllByTestId("miniature-muted")).toHaveLength(1);
    expect(screen.getByTestId("live-chart").textContent).toBe("a");
  });

  it("draws only the top rows, starting at the report's first item", () => {
    render(
      <ReportMiniature
        maxRows={6}
        items={[chart("a", 0, 20), chart("b", 0, 23), chart("c", 0, 26)]}
        visualizationById={vizMap("a", "b", "c")}
      />,
    );

    expect(
      screen
        .getAllByTestId("miniature-chart")
        .map((block) => block.style.getPropertyValue("--row")),
    ).toEqual(["1 / span 3", "4 / span 3"]);
  });
});

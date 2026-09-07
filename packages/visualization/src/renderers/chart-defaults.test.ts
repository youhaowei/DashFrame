import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createAPIContext } from "@uwdata/vgplot";
import type { Plot } from "@observablehq/plot";
import type { ChartConfig } from "../chart-renderers";
import { createVgplotRenderer } from "./vgplot-renderer";

type Row = { category: string; value: number; series?: string };
type ChartType = "barY" | "barX" | "line";
const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function renderChart(
  rows: Row[],
  type: ChartType,
  config: Partial<ChartConfig> = {},
) {
  const api = createAPIContext();
  vi.spyOn(api.context.coordinator, "connect").mockImplementation(() => {});
  // Exercise the installed vgplot → Plot path with in-memory rows. SQL and
  // query aggregation are covered separately; no DuckDB fixture is needed.
  const renderer = createVgplotRenderer({
    ...api,
    from: () => rows,
  } as unknown as typeof api);
  const container = document.createElement("div");
  document.body.appendChild(container);
  cleanups.push(
    renderer.render(container, type, {
      tableName: "fixture",
      width: 640,
      height: 360,
      encoding:
        type === "barX"
          ? { x: "value", y: "category" }
          : { x: "category", y: "value" },
      ...config,
    }),
  );
  await vi.waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
  return container.querySelector("svg") as SVGSVGElement & Plot;
}

// Plot emits either rectangles or rounded paths. Read their actual extents;
// jsdom has no SVG getBBox implementation.
function bounds(node: Element) {
  if (node.tagName === "rect") {
    const x = Number(node.getAttribute("x"));
    const y = Number(node.getAttribute("y"));
    return {
      x,
      y,
      width: Number(node.getAttribute("width")),
      height: Number(node.getAttribute("height")),
    };
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const match of (node.getAttribute("d") ?? "").matchAll(
    /([MHVA])([^MHVAZ]+)/g,
  )) {
    const coordinates = match[2]!.trim().split(/[ ,]+/).map(Number);
    if (match[1] === "H") xs.push(coordinates[0]!);
    else if (match[1] === "V") ys.push(coordinates[0]!);
    else {
      xs.push(coordinates.at(-2)!);
      ys.push(coordinates.at(-1)!);
    }
  }
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const bars = (svg: SVGSVGElement) => [
  ...svg.querySelectorAll(
    '[aria-label="bar"] > path, [aria-label="bar"] > rect',
  ),
];

describe.each(["barY", "barX"] as const)("%s chart defaults", (type) => {
  it.each([1, 2, 32])(
    "bounds %i categories at both card and full widths",
    async (count) => {
      const rows = Array.from({ length: count }, (_, i) => ({
        category: `Category ${i}`,
        value: 10,
      }));
      for (const width of [280, 900]) {
        const svg = await renderChart(rows, type, { width });
        const rectangles = bars(svg).map(bounds);
        expect(rectangles).toHaveLength(count);
        for (const rect of rectangles) {
          const thickness = type === "barX" ? rect.height : rect.width;
          expect(thickness).toBeGreaterThan(0);
          expect(thickness).toBeLessThanOrEqual(48.001);
          if (count <= 2) expect(thickness).toBeCloseTo(48);
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        }
        const positions = rectangles
          .map((rect) => (type === "barX" ? rect.y : rect.x))
          .sort((a, b) => a - b);
        expect(new Set(positions).size).toBe(count);
      }
    },
  );

  it("preserves zero baselines and negative lengths, rounding only the outer end", async () => {
    const svg = await renderChart(
      [
        { category: "Loss", value: -10 },
        { category: "Gain", value: 20 },
      ],
      type,
    );
    const metric = svg.scale(type === "barX" ? "x" : "y")!;
    const zero = metric.apply!(0);
    const shapes = bars(svg);
    const rectangles = shapes.map(bounds);
    const lengths = rectangles
      .map((rect) => (type === "barX" ? rect.width : rect.height))
      .sort((a, b) => a - b);
    expect(lengths[1]! / lengths[0]!).toBeCloseTo(2);
    for (const rect of rectangles) {
      const start = type === "barX" ? rect.x : rect.y;
      const end = start + (type === "barX" ? rect.width : rect.height);
      expect(
        Math.min(Math.abs(start - zero), Math.abs(end - zero)),
      ).toBeLessThan(0.001);
    }
    // Each outer end has two curved corners; the two baseline corners are square.
    for (const shape of shapes) {
      expect(shape.getAttribute("d")?.match(/A3,3/g)).toHaveLength(2);
      expect(shape.getAttribute("d")?.match(/A0,0/g)).toHaveLength(2);
    }
  });

  it("preserves stacked segment totals and color encoding", async () => {
    const svg = await renderChart(
      [
        { category: "A", value: 10, series: "First" },
        { category: "A", value: 20, series: "Second" },
      ],
      type,
      {
        encoding:
          type === "barX"
            ? { x: "value", y: "category", color: "series" }
            : { x: "category", y: "value", color: "series" },
      },
    );
    const shapes = bars(svg);
    expect(shapes).toHaveLength(2);
    expect(new Set(shapes.map((node) => node.getAttribute("fill"))).size).toBe(
      2,
    );
    const rectangles = shapes.map(bounds);
    const total = rectangles.reduce(
      (sum, rect) => sum + (type === "barX" ? rect.width : rect.height),
      0,
    );
    const metric = svg.scale(type === "barX" ? "x" : "y")!;
    expect(total).toBeCloseTo(Math.abs(metric.apply!(30) - metric.apply!(0)));
    expect(shapes.every((node) => node.tagName === "rect")).toBe(true);
  });
});

it("keeps previews axis-free and honors typography theme overrides", async () => {
  const rows = [
    { category: "A", value: 10 },
    { category: "B", value: 20 },
  ];
  const full = await renderChart(rows, "barY", {
    theme: {
      fontFamily: "serif",
      fontSize: 15,
      textColor: "navy",
      borderColor: "silver",
    },
  });
  expect(full.style.fontFamily).toBe("serif");
  expect(full.style.fontSize).toBe("15px");
  expect(full.style.color).toBe("navy");
  expect(
    full.parentElement!.style.getPropertyValue("--dashframe-chart-grid"),
  ).toBe("silver");
  expect(full.textContent).not.toMatch(/[↑→]/);
  const preview = await renderChart(rows, "barY", { preview: true });
  expect(
    preview.querySelector('[aria-label*="axis"], [aria-label*="grid"]'),
  ).toBeNull();
  expect(preview.style.fontSize).toBe("12px");
});

it("labels both line series with their rendered colors and omits preview legends", async () => {
  const rows = [
    { category: "A", value: 10, series: "Direct" },
    { category: "B", value: 20, series: "Direct" },
    { category: "A", value: 5, series: "Referral" },
    { category: "B", value: 15, series: "Referral" },
  ];
  const encoding = { x: "category", y: "value", color: "series" };
  const svg = await renderChart(rows, "line", { encoding });
  const legend = svg.parentElement!.querySelector(".legend")!;
  expect(legend).not.toBeNull();
  const items = [...legend.querySelectorAll("span")];
  expect(items.map((item) => item.textContent)).toEqual(["Direct", "Referral"]);
  for (const item of items) {
    expect(item.querySelector("svg")?.getAttribute("fill")).toBe(
      svg.scale("color")!.apply!(item.textContent),
    );
  }
  expect(Number(svg.getAttribute("height")) + 36).toBe(360);
  expect(
    svg.querySelector('[aria-label="line"]')?.getAttribute("stroke-width"),
  ).toBe("2");
  const preview = await renderChart(rows, "line", { encoding, preview: true });
  expect(preview.parentElement!.querySelector(".legend")).toBeNull();
  expect(Number(preview.getAttribute("height"))).toBe(360);
});

it("renders an explicitly black accent without replacing it with gray", async () => {
  // jsdom has no canvas. Supply the black pixel that a real canvas returns;
  // the chart still goes through the installed vgplot and Plot renderers.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        fillStyle: "#000000",
        fillRect: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
      }) as unknown as CanvasRenderingContext2D,
  );
  const svg = await renderChart([{ category: "A", value: 10 }], "barY", {
    theme: { accentColor: "#000000" },
  });
  expect(svg.querySelector('[aria-label="bar"]')?.getAttribute("fill")).toBe(
    "#000000",
  );
});

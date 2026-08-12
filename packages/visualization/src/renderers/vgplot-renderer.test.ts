import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVgplotRenderer,
  isExpressionBoundColor,
  setupColorDomain,
} from "./vgplot-renderer";

// ============================================================================
// Helpers
// ============================================================================

function createMockApi(options?: {
  query?: ReturnType<typeof vi.fn>;
  colorDomain?: ReturnType<typeof vi.fn>;
  plot?: ReturnType<typeof vi.fn>;
}) {
  const query =
    options?.query ??
    vi.fn(() => Promise.resolve([{ val: "A" }, { val: "B" }]));
  const colorDomain =
    options?.colorDomain ??
    vi.fn((domain: string[]) => ({ __directive: "colorDomain", domain }));
  const plot =
    options?.plot ??
    vi.fn((..._args: unknown[]) => {
      const el = document.createElement("div");
      el.setAttribute("data-plot", "true");
      return el;
    });

  const passthrough =
    (name: string) =>
    (...args: unknown[]) => ({ __directive: name, args });

  return {
    from: vi.fn(() => ({ __source: true })),
    barY: vi.fn(() => ({ __mark: "barY" })),
    barX: vi.fn(() => ({ __mark: "barX" })),
    lineY: vi.fn(() => ({ __mark: "lineY" })),
    areaY: vi.fn(() => ({ __mark: "areaY" })),
    dot: vi.fn(() => ({ __mark: "dot" })),
    hexbin: vi.fn(() => ({ __mark: "hexbin" })),
    heatmap: vi.fn(() => ({ __mark: "heatmap" })),
    raster: vi.fn(() => ({ __mark: "raster" })),
    count: vi.fn(() => ({ __agg: "count" })),
    sum: vi.fn((col: string) => ({ __agg: "sum", col })),
    avg: vi.fn((col: string) => ({ __agg: "avg", col })),
    width: passthrough("width"),
    height: passthrough("height"),
    marginRight: passthrough("marginRight"),
    marginTop: passthrough("marginTop"),
    margin: passthrough("margin"),
    axis: passthrough("axis"),
    yTickFormat: passthrough("yTickFormat"),
    yGrid: passthrough("yGrid"),
    xTickFormat: passthrough("xTickFormat"),
    xGrid: passthrough("xGrid"),
    xLabel: passthrough("xLabel"),
    yLabel: passthrough("yLabel"),
    colorLabel: passthrough("colorLabel"),
    xScale: passthrough("xScale"),
    yScale: passthrough("yScale"),
    colorRange: vi.fn((colors: string[]) => ({
      __directive: "colorRange",
      colors,
    })),
    colorDomain,
    plot,
    sql: vi.fn(),
    context: {
      coordinator: { query },
    },
  };
}

/**
 * jsdom has no canvas, and `colorToHex` uses one to normalize CSS colors —
 * without a stub every render logs "Not implemented: getContext" and the
 * palette silently collapses to the gray fallback. Returns the hex the test
 * already set, so `getChartColors()` yields a real multi-color palette.
 */
function stubCanvasColorParsing() {
  const parse = (color: string) => {
    const hex = color.replace("#", "");
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  };

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        set fillStyle(value: string) {
          this._fill = value;
        },
        get fillStyle(): string {
          return (this._fill as string) ?? "#000000";
        },
        fillRect: () => {},
        getImageData() {
          const [r, g, b] = parse((this.fillStyle as string) || "#6b7280");
          return { data: [r, g, b, 255] };
        },
      }) as unknown as CanvasRenderingContext2D,
  );
}

/** Ensure getChartColors() returns non-empty palette in jsdom. */
function setChartColorCssVars() {
  document.documentElement.style.setProperty("--chart-1", "#e97838");
  document.documentElement.style.setProperty("--chart-2", "#3b82f6");
  document.documentElement.style.setProperty("--chart-3", "#22c55e");
  document.documentElement.style.setProperty("--chart-4", "#a855f7");
  document.documentElement.style.setProperty("--chart-5", "#ef4444");
  document.documentElement.style.setProperty("--radius", "0.5rem");
}

function clearChartColorCssVars() {
  for (const prop of [
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
    "--radius",
  ]) {
    document.documentElement.style.removeProperty(prop);
  }
}

// ============================================================================
// isExpressionBoundColor
// ============================================================================

describe("isExpressionBoundColor", () => {
  it("returns false for plain column names", () => {
    expect(isExpressionBoundColor("category")).toBe(false);
    expect(isExpressionBoundColor("order status")).toBe(false);
  });

  it("returns true for aggregation expressions", () => {
    expect(isExpressionBoundColor("sum(amount)")).toBe(true);
    expect(isExpressionBoundColor("avg(price)")).toBe(true);
    expect(isExpressionBoundColor("count(id)")).toBe(true);
    expect(isExpressionBoundColor("count_distinct(user_id)")).toBe(true);
  });
});

// ============================================================================
// setupColorDomain
// ============================================================================

describe("setupColorDomain", () => {
  it("quotes color-column and table identifiers in its distinct-values query", async () => {
    const query = vi.fn(() => Promise.resolve([]));
    const api = createMockApi({ query });

    await setupColorDomain(api, 'order "status"', 'sales order"archive');

    expect(query).toHaveBeenCalledWith(
      'SELECT DISTINCT "order ""status""" as val FROM "sales order""archive" ORDER BY "order ""status"""',
      { type: "json" },
    );
  });

  it("pins schema-qualified tableName as a single quoted identifier (not split)", async () => {
    // Latent divergence vs api.from(): domain query quotes the whole string as
    // one identifier. This test pins that current behavior.
    const query = vi.fn(() => Promise.resolve([]));
    const api = createMockApi({ query });

    await setupColorDomain(api, "region", "analytics.sales");

    expect(query).toHaveBeenCalledWith(
      'SELECT DISTINCT "region" as val FROM "analytics.sales" ORDER BY "region"',
      { type: "json" },
    );
  });

  it("returns a colorDomain directive for a plain column with non-empty domain", async () => {
    const colorDomain = vi.fn((domain: string[]) => ({
      __directive: "colorDomain",
      domain,
    }));
    const query = vi.fn(() =>
      Promise.resolve([{ val: "east" }, { val: "west" }]),
    );
    const api = createMockApi({ query, colorDomain });

    const directive = await setupColorDomain(api, "region", "sales");

    expect(query).toHaveBeenCalledOnce();
    expect(colorDomain).toHaveBeenCalledWith(["east", "west"]);
    expect(directive).toEqual({
      __directive: "colorDomain",
      domain: ["east", "west"],
    });
  });

  it("preserves the value type of the domain (numeric columns stay numeric)", async () => {
    const colorDomain = vi.fn((domain: unknown[]) => ({
      __directive: "colorDomain",
      domain,
    }));
    // DuckDB returns integers as BigInt over the JSON path.
    const query = vi.fn(() => Promise.resolve([{ val: 1n }, { val: 2n }]));
    const api = createMockApi({ query, colorDomain });

    await setupColorDomain(api, "tier", "sales");

    expect(colorDomain).toHaveBeenCalledWith([1, 2]);
  });

  it("skips the domain when a bigint value cannot be narrowed without loss", async () => {
    const colorDomain = vi.fn((domain: unknown[]) => ({
      __directive: "colorDomain",
      domain,
    }));
    // Two distinct ids that both narrow to 2 ** 53 — an explicit domain built
    // from them would map two categories onto one colour.
    const query = vi.fn(() =>
      Promise.resolve([{ val: 9007199254740993n }, { val: 9007199254740995n }]),
    );
    const api = createMockApi({ query, colorDomain });

    const directive = await setupColorDomain(api, "tier", "sales");

    expect(colorDomain).not.toHaveBeenCalled();
    expect(directive).toBeUndefined();
  });

  it("skips the domain query for metric/expression-bound color (no query, no throw)", async () => {
    const query = vi.fn(() => Promise.resolve([]));
    const colorDomain = vi.fn();
    const api = createMockApi({ query, colorDomain });

    const directive = await setupColorDomain(api, "sum(amount)", "sales");

    expect(query).not.toHaveBeenCalled();
    expect(colorDomain).not.toHaveBeenCalled();
    expect(directive).toBeUndefined();
  });

  it("logs a warning and returns undefined when the domain query fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const query = vi.fn(() => Promise.reject(new Error("duckdb boom")));
    const colorDomain = vi.fn();
    const api = createMockApi({ query, colorDomain });

    const directive = await setupColorDomain(api, "region", "sales");

    expect(directive).toBeUndefined();
    expect(colorDomain).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[VgplotRenderer] Could not set color domain:",
      expect.any(Error),
    );

    warn.mockRestore();
  });
});

// ============================================================================
// createVgplotRenderer — color domain in plot options
// ============================================================================

describe("createVgplotRenderer color domain", () => {
  beforeEach(() => {
    stubCanvasColorParsing();
    setChartColorCssVars();
  });

  afterEach(() => {
    clearChartColorCssVars();
    vi.restoreAllMocks();
  });

  it("groups colored line charts by the color column", () => {
    const api = createMockApi();
    const renderer = createVgplotRenderer(api as never);
    const container = document.createElement("div");

    const cleanup = renderer.render(container, "line", {
      tableName: "weekly_acquisition",
      encoding: { x: "yearWeek", y: "activeUsers", color: "channel" },
    });

    expect(api.lineY).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        x: "yearWeek",
        y: "activeUsers",
        stroke: "channel",
        z: "channel",
      }),
    );

    cleanup();
  });

  it("does not split expression-bound line color into one-point series", () => {
    const api = createMockApi();
    const renderer = createVgplotRenderer(api as never);
    const container = document.createElement("div");

    const cleanup = renderer.render(container, "line", {
      tableName: "sales",
      encoding: { x: "date", y: "revenue", color: "sum(profit)" },
    });

    expect(api.lineY).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        x: "date",
        y: "revenue",
        stroke: expect.anything(),
      }),
    );
    expect(api.lineY.mock.calls[0]?.[1]).not.toHaveProperty("z");

    cleanup();
  });

  it("includes the colorDomain directive in options passed to api.plot for a plain color column", async () => {
    const colorDomainDirective = {
      __directive: "colorDomain",
      domain: ["A", "B"],
    };
    const colorDomain = vi.fn(() => colorDomainDirective);
    const plot = vi.fn((..._args: unknown[]) => {
      const el = document.createElement("div");
      el.setAttribute("data-plot", "true");
      return el;
    });
    const query = vi.fn(() => Promise.resolve([{ val: "A" }, { val: "B" }]));
    const api = createMockApi({ query, colorDomain, plot });

    const renderer = createVgplotRenderer(api as never);
    const container = document.createElement("div");

    const cleanup = renderer.render(container, "barY", {
      tableName: "sales",
      encoding: { x: "category", y: "sum(value)", color: "region" },
    });

    await vi.waitFor(() => {
      expect(plot).toHaveBeenCalled();
    });

    const plotArgs = plot.mock.calls[0] as unknown[];
    expect(plotArgs).toContain(colorDomainDirective);
    expect(colorDomain).toHaveBeenCalledWith(["A", "B"]);
    expect(query).toHaveBeenCalledOnce();

    // colorRange sibling still present
    expect(
      plotArgs.some(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as { __directive?: string }).__directive === "colorRange",
      ),
    ).toBe(true);

    cleanup();
  });

  it("does not issue a domain query when color is expression-bound; chart still plots", async () => {
    const plot = vi.fn((..._args: unknown[]) => {
      const el = document.createElement("div");
      el.setAttribute("data-plot", "true");
      return el;
    });
    const query = vi.fn(() => Promise.resolve([]));
    const colorDomain = vi.fn();
    const api = createMockApi({ query, colorDomain, plot });

    const renderer = createVgplotRenderer(api as never);
    const container = document.createElement("div");

    const cleanup = renderer.render(container, "barY", {
      tableName: "sales",
      encoding: { x: "category", y: "value", color: "sum(amount)" },
    });

    // Sync path for expression-bound color — plot is immediate
    expect(plot).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
    expect(colorDomain).not.toHaveBeenCalled();

    const plotArgs = plot.mock.calls[0] as unknown[];
    expect(
      plotArgs.some(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as { __directive?: string }).__directive === "colorDomain",
      ),
    ).toBe(false);

    cleanup();
  });

  it("still plots and warns when the domain query fails on the plain-column path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plot = vi.fn((..._args: unknown[]) => {
      const el = document.createElement("div");
      el.setAttribute("data-plot", "true");
      return el;
    });
    const query = vi.fn(() => Promise.reject(new Error("query failed")));
    const colorDomain = vi.fn();
    const api = createMockApi({ query, colorDomain, plot });

    const renderer = createVgplotRenderer(api as never);
    const container = document.createElement("div");

    const cleanup = renderer.render(container, "barY", {
      tableName: "sales",
      encoding: { x: "category", y: "sum(value)", color: "region" },
    });

    await vi.waitFor(() => {
      expect(plot).toHaveBeenCalled();
    });

    expect(colorDomain).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[VgplotRenderer] Could not set color domain:",
      expect.any(Error),
    );
    // Chart still mounted
    expect(container.querySelector("[data-plot]")).not.toBeNull();

    cleanup();
    warn.mockRestore();
  });
});

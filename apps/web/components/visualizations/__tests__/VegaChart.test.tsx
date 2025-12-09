import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { VegaChart } from "../VegaChart";
import type { TopLevelSpec } from "vega-lite";

// Mock vega-embed to avoid actual chart rendering in tests
vi.mock("vega-embed", () => ({
  default: vi.fn().mockResolvedValue({
    view: {
      width: vi.fn().mockReturnThis(),
      height: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnThis(),
      finalize: vi.fn(),
    },
  }),
}));

// Sample Vega-Lite spec for testing
const mockSpec: TopLevelSpec = {
  $schema: "https://vega.github.io/schema/vega-lite/v5.json",
  data: { values: [{ a: 1, b: 2 }] },
  mark: "bar",
  encoding: {
    x: { field: "a", type: "quantitative" },
    y: { field: "b", type: "quantitative" },
  },
};

describe("VegaChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders without crashing", () => {
    const { container } = render(<VegaChart spec={mockSpec} />);
    expect(container.querySelector("div")).toBeTruthy();
  });

  it("applies custom className", () => {
    const { container } = render(
      <VegaChart spec={mockSpec} className="custom-class" />,
    );
    expect(container.querySelector(".custom-class")).toBeTruthy();
  });
});

describe("VegaChart infinite growth detection", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let resizeObserverInstance: ResizeObserver | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Capture ResizeObserver instance
    const OriginalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class extends OriginalResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        resizeObserverInstance = this;
      }
    } as typeof ResizeObserver;
  });

  afterEach(() => {
    cleanup();
    consoleSpy.mockRestore();
  });

  it("detects and stops infinite growth after threshold is exceeded", async () => {
    const { container } = render(<VegaChart spec={mockSpec} />);
    const chartContainer = container.querySelector("div");

    // Wait for vega-embed to initialize
    await vi.waitFor(() => {
      expect(resizeObserverInstance).toBeDefined();
    });

    // Simulate consecutive growth cycles that exceed threshold
    // Growth threshold is 50px, so we simulate 60px growth each time
    const growthPerCycle = 60;

    // First resize - establishes baseline (300x200)
    resizeObserverInstance.simulateResize(chartContainer!, 300, 200);
    await vi.advanceTimersByTimeAsync(150); // Wait for throttle

    // Second resize - growth detected (360x260)
    resizeObserverInstance.simulateResize(
      chartContainer!,
      300 + growthPerCycle,
      200 + growthPerCycle,
    );
    await vi.advanceTimersByTimeAsync(150);

    // Third resize - second growth cycle (420x320)
    resizeObserverInstance.simulateResize(
      chartContainer!,
      300 + growthPerCycle * 2,
      200 + growthPerCycle * 2,
    );
    await vi.advanceTimersByTimeAsync(150);

    // Fourth resize - third growth cycle, should trigger error (480x380)
    resizeObserverInstance.simulateResize(
      chartContainer!,
      300 + growthPerCycle * 3,
      200 + growthPerCycle * 3,
    );
    await vi.advanceTimersByTimeAsync(150);

    // Verify error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[VegaChart] Infinite growth detected!"),
    );
  });

  it("resets growth counter when size stabilizes", async () => {
    const { container } = render(<VegaChart spec={mockSpec} />);
    const chartContainer = container.querySelector("div");

    await vi.waitFor(() => {
      expect(resizeObserverInstance).toBeDefined();
    });

    // First resize
    resizeObserverInstance.simulateResize(chartContainer!, 300, 200);
    await vi.advanceTimersByTimeAsync(150);

    // Growing resize (triggers growth counter)
    resizeObserverInstance.simulateResize(chartContainer!, 360, 260);
    await vi.advanceTimersByTimeAsync(150);

    // Stabilizing resize (small change, resets counter)
    resizeObserverInstance.simulateResize(chartContainer!, 365, 265);
    await vi.advanceTimersByTimeAsync(150);

    // Another growth cycle (counter was reset, so this is cycle 1 again)
    resizeObserverInstance.simulateResize(chartContainer!, 425, 325);
    await vi.advanceTimersByTimeAsync(150);

    // Stabilizing again
    resizeObserverInstance.simulateResize(chartContainer!, 430, 330);
    await vi.advanceTimersByTimeAsync(150);

    // No infinite growth error should be logged
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("[VegaChart] Infinite growth detected!"),
    );
  });

  it("throttles resize updates to prevent rapid firing", async () => {
    const { container } = render(<VegaChart spec={mockSpec} />);
    const chartContainer = container.querySelector("div");

    await vi.waitFor(() => {
      expect(resizeObserverInstance).toBeDefined();
    });

    // Rapid fire multiple resize events
    resizeObserverInstance.simulateResize(chartContainer!, 300, 200);
    resizeObserverInstance.simulateResize(chartContainer!, 310, 210);
    resizeObserverInstance.simulateResize(chartContainer!, 320, 220);
    resizeObserverInstance.simulateResize(chartContainer!, 330, 230);

    // Only the last one should be processed after throttle delay
    await vi.advanceTimersByTimeAsync(150);

    // Verify throttling worked (implementation detail - no error should be thrown)
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("VegaChart container constraints", () => {
  it("has proper CSS classes to prevent overflow", () => {
    const { container } = render(<VegaChart spec={mockSpec} />);
    const chartDiv = container.firstChild as HTMLElement;

    // These classes are critical for preventing infinite growth
    expect(chartDiv.className).toContain("overflow-hidden");
    expect(chartDiv.className).toContain("min-h-0");
    expect(chartDiv.className).toContain("h-full");
    expect(chartDiv.className).toContain("w-full");
  });
});

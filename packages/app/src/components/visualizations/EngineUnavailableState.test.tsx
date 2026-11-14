/**
 * Tests for EngineUnavailableState — the persistent inline affordance shown
 * where a chart would render when the data engine can't be reached (see #96).
 *
 * Contract verified: the Reload button triggers the renderer's reload path.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EngineUnavailableState } from "./EngineUnavailableState";

describe("EngineUnavailableState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("triggers the renderer reload path when Reload is clicked", () => {
    const reload = vi.fn();
    // window.location.reload is non-writable in jsdom; redefine for the test.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(<EngineUnavailableState />);
    fireEvent.click(screen.getByRole("button", { name: /reload/i }));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

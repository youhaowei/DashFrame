/**
 * Tests for EngineUnavailableState — the persistent inline affordance shown
 * where a chart would render when the data engine can't be reached (see #96).
 *
 * Contracts verified:
 * 1. Persistent inline surface (not a toast): renders a visible title + body in
 *    the DOM, present immediately on mount and not auto-dismissing.
 * 2. Actionable: renders a real "Reload" button.
 * 3. The Reload button triggers the renderer's reload path.
 * 4. Copy is plain-language: no implementation terms (native/WASM/Mosaic/engine
 *    jargon beyond the allowed "data engine"), and the exact decided strings.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineUnavailableState } from "./EngineUnavailableState";

describe("EngineUnavailableState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a persistent inline title and body (not a toast)", () => {
    render(<EngineUnavailableState />);

    // Title and body are visible in the DOM right away — this is the persistent
    // affordance, not an ephemeral notification.
    expect(screen.getByText("Charts can't load right now")).not.toBeNull();
    expect(
      screen.getByText(
        "The data engine isn't responding. Reload to reconnect.",
      ),
    ).not.toBeNull();
  });

  it("renders a Reload button (the action, not instruction-as-homework)", () => {
    render(<EngineUnavailableState />);

    expect(screen.getByRole("button", { name: /reload/i })).not.toBeNull();
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

  it("uses plain language — no implementation terms leak into copy", () => {
    const { container } = render(<EngineUnavailableState />);
    const text = container.textContent ?? "";

    // "data engine" is the allowed plain-language term; the forbidden ones are
    // implementation leaks the user has no mental model for.
    expect(text).not.toMatch(/native/i);
    expect(text).not.toMatch(/\bWASM\b/i);
    expect(text).not.toMatch(/mosaic/i);
    expect(text).not.toMatch(/loopback|127\.0\.0\.1/i);
  });
});

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { OverlayScrollArea } from "./OverlayScrollArea";

const viewportOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".overscroll-contain");

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("OverlayScrollArea viewport tab stop", () => {
  it("leaves the scroll area's own tab stop alone when no override is given", () => {
    // Base UI makes an overflowing viewport focusable so a scrollable region
    // stays keyboard-reachable, and decides the value itself. Forwarding an
    // undefined tabIndex would erase that for every caller, because merging
    // props does not skip undefined.
    const { container } = render(
      <OverlayScrollArea>
        <p>content</p>
      </OverlayScrollArea>,
    );

    expect(viewportOf(container)?.hasAttribute("tabindex")).toBe(true);
  });

  it("takes the viewport out of the tab order when a caller opts out", () => {
    const { container } = render(
      <OverlayScrollArea viewportTabIndex={-1}>
        <p>content</p>
      </OverlayScrollArea>,
    );

    expect(viewportOf(container)?.getAttribute("tabindex")).toBe("-1");
  });
});

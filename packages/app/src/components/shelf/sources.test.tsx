/**
 * A chart's "Put on shelf" button names the chart it puts there, so a report
 * with several tiles reads as several distinct buttons, and pressing it
 * shelves that chart.
 */
import { nativeQueryMock } from "@/test/native-query-fixture";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(() => ({ data: undefined })),
}));

import { AppDragProvider } from "./drag-context";
import { ShelfScope } from "./shelf-scope";
import { readShelf, shelfStorageKey } from "./shelf-store";
import { PutChartOnShelfButton } from "./sources";

const P1 = shelfStorageKey("p1");

function renderButton(name: string) {
  return render(
    <AppDragProvider overlay={() => null}>
      <ShelfScope storageKey={P1}>
        <PutChartOnShelfButton chart={{ id: "v1", name, insightId: "i1" }} />
      </ShelfScope>
    </AppDragProvider>,
  );
}

describe("PutChartOnShelfButton", () => {
  beforeEach(() => window.localStorage.clear());

  it("names the chart and puts it on the shelf", () => {
    renderButton("Sales by Product");
    fireEvent.click(
      screen.getByRole("button", { name: "Put Sales by Product on shelf" }),
    );
    expect(readShelf(P1).map((item) => item.id)).toEqual(["v1"]);
  });

  it("falls back to Untitled chart for a chart with no name", () => {
    renderButton("");
    expect(
      screen.getByRole("button", { name: "Put Untitled chart on shelf" }),
    ).toBeTruthy();
  });
});

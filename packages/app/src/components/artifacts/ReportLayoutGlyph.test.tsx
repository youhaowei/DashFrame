import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { ReportLayoutGlyph } from "./ReportLayoutGlyph";

const chart = (id: string, y: number, height: number) =>
  ({ id, type: "visualization", x: 0, y, width: 12, height }) as const;

describe("ReportLayoutGlyph", () => {
  it("draws only the top rows of a long report", () => {
    render(
      <ReportLayoutGlyph
        maxRows={12}
        items={[
          chart("top", 0, 6),
          chart("middle", 6, 10),
          chart("below", 20, 6),
        ]}
      />,
    );

    const blocks = screen.getAllByTestId("report-glyph-block");
    expect(
      blocks.map((block) => block.style.getPropertyValue("--row")),
    ).toEqual(["1 / span 6", "7 / span 6"]);
  });

  it("starts the miniature at the report's first item", () => {
    render(<ReportLayoutGlyph items={[chart("only", 30, 4)]} />);

    expect(
      screen.getByTestId("report-glyph-block").style.getPropertyValue("--row"),
    ).toBe("1 / span 4");
  });
});

import { describe, expect, it, vi } from "vitest";
import { setupColorDomain } from "./vgplot-renderer";

describe("setupColorDomain", () => {
  it("quotes color-column and table identifiers in its distinct-values query", () => {
    const query = vi.fn(() => Promise.resolve([]));
    const api = {
      context: {
        coordinator: { query },
      },
    };

    setupColorDomain(api, 'order "status"', 'sales order"archive');

    expect(query).toHaveBeenCalledWith(
      'SELECT DISTINCT "order ""status""" as val FROM "sales order""archive" ORDER BY "order ""status"""',
      { type: "json" },
    );
  });
});

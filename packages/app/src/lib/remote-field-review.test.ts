import type { Field, UUID } from "@dashframe/types";
import { describe, expect, it, vi } from "vitest";
import { reviewUnclassifiedRemoteFields } from "./remote-field-review";

const TABLE_ID = "11111111-1111-4111-8111-111111111111" as UUID;

function field(name: string, sensitivity?: Field["sensitivity"]): Field {
  return {
    id: crypto.randomUUID(),
    tableId: TABLE_ID,
    name,
    columnName: name,
    type: "string",
    sensitivity,
  };
}

describe("reviewUnclassifiedRemoteFields", () => {
  it("requires a separate decision for every unclassified field", async () => {
    const fields = [
      field("email"),
      field("phone"),
      field("country", "cleared"),
    ];
    const requestReview = vi.fn().mockResolvedValue(true);

    const reviewed = await reviewUnclassifiedRemoteFields(
      fields,
      requestReview,
    );

    expect(requestReview).toHaveBeenNthCalledWith(1, {
      field: fields[0],
      position: 1,
      total: 2,
    });
    expect(requestReview).toHaveBeenNthCalledWith(2, {
      field: fields[1],
      position: 2,
      total: 2,
    });
    expect(reviewed).toEqual([
      expect.objectContaining({
        name: "email",
        sensitivity: "cleared",
        sensitivityReason: "Cleared by you",
        sensitivitySource: "user",
      }),
      expect.objectContaining({
        name: "phone",
        sensitivity: "cleared",
        sensitivityReason: "Cleared by you",
        sensitivitySource: "user",
      }),
      fields[2],
    ]);
  });

  it("stops without returning partially reviewed metadata when cancelled", async () => {
    const requestReview = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      reviewUnclassifiedRemoteFields(
        [field("email"), field("phone"), field("name")],
        requestReview,
      ),
    ).resolves.toBeNull();
    expect(requestReview).toHaveBeenCalledTimes(2);
  });

  it("preserves already classified fields without prompting", async () => {
    const fields = [field("country", "cleared")];
    const requestReview = vi.fn();

    await expect(
      reviewUnclassifiedRemoteFields(fields, requestReview),
    ).resolves.toEqual(fields);
    expect(requestReview).not.toHaveBeenCalled();
  });
});

import {
  buildSensitivityUpdate,
  getFieldSensitivity,
  type Field,
} from "@dashframe/types";

export interface RemoteFieldReviewRequest {
  field: Field;
  position: number;
  total: number;
}

/** Require an explicit user decision for each unclassified remote field. */
export async function reviewUnclassifiedRemoteFields(
  fields: Field[],
  requestReview: (request: RemoteFieldReviewRequest) => Promise<boolean>,
): Promise<Field[] | null> {
  const reviewedFields: Field[] = [];
  const unclassifiedFields = fields.filter(
    (field) => getFieldSensitivity(field) === "unclassified",
  );
  let position = 0;

  for (const field of fields) {
    if (getFieldSensitivity(field) !== "unclassified") {
      reviewedFields.push(field);
      continue;
    }

    position += 1;
    const isSafe = await requestReview({
      field,
      position,
      total: unclassifiedFields.length,
    });
    if (!isSafe) return null;

    reviewedFields.push({
      ...field,
      ...buildSensitivityUpdate("cleared"),
    });
  }

  return reviewedFields;
}

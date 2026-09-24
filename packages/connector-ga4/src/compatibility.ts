import type { DefinitionCompatibility } from "@dashframe/engine";

import type { Ga4TableDefinition } from "./definition.js";
import { definitionFilters, validateDefinition } from "./definition.js";
import type { Ga4ApiClient } from "./metadata.js";
import { propertyResource } from "./metadata.js";

interface CompatibilityEntry {
  compatibility?: unknown;
  dimensionMetadata?: { apiName?: unknown };
  metricMetadata?: { apiName?: unknown };
  reason?: unknown;
}

interface CompatibilityResponse {
  dimensionCompatibilities?: CompatibilityEntry[];
  metricCompatibilities?: CompatibilityEntry[];
}

export function parseCompatibility(
  body: CompatibilityResponse,
  requestedFields?: ReadonlySet<string>,
): DefinitionCompatibility {
  const entries = [
    ...(body.dimensionCompatibilities ?? []),
    ...(body.metricCompatibilities ?? []),
  ];
  const incompatible = entries.flatMap((entry) => {
    if (entry.compatibility !== "INCOMPATIBLE") return [];
    const name =
      entry.dimensionMetadata?.apiName ?? entry.metricMetadata?.apiName;
    if (typeof name !== "string") return [];
    if (requestedFields && !requestedFields.has(name)) return [];
    return [
      {
        field: name,
        reason:
          typeof entry.reason === "string"
            ? entry.reason
            : "GA4 reports this field as incompatible with the definition",
      },
    ];
  });
  return incompatible.length ? { ok: false, incompatible } : { ok: true };
}

export async function checkCompatibility(
  site: string,
  definition: Ga4TableDefinition,
  client: Ga4ApiClient,
): Promise<DefinitionCompatibility> {
  const validation = validateDefinition(definition);
  if (!validation.valid) {
    return {
      ok: false,
      incompatible: validation.errors.map((reason) => ({
        field: "definition",
        reason,
      })),
    };
  }
  const property = propertyResource(site);
  const body = (await client.request(
    `https://analyticsdata.googleapis.com/v1beta/${property}:checkCompatibility`,
    {
      method: "POST",
      body: JSON.stringify({
        dimensions: definition.dimensions.map((name) => ({ name })),
        metrics: definition.metrics.map((name) => ({ name })),
        ...definitionFilters(definition),
      }),
    },
  )) as CompatibilityResponse;
  return parseCompatibility(
    body,
    new Set([
      ...definition.dimensions,
      ...definition.metrics,
      ...(definition.filters ?? []).map((filter) => filter.field),
    ]),
  );
}

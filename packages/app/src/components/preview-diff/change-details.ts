/**
 * Labels and change-detail derivation for a PreviewDiff, shared by the drafts
 * review surface. `getChangeDetails` turns a direct node's before slice and
 * proposed definition into the per-key rows a reviewer reads.
 */

import { sanitizeDashboardItemUpdates } from "@dashframe/server/dashboard-item-updates";
import type {
  ArtifactKind,
  PreviewDirectNode,
  PreviewDownstreamNode,
} from "@dashframe/types";

export const KIND_LABELS: Record<ArtifactKind, string> = {
  dataSource: "Data Source",
  dataTable: "Data Table",
  insight: "Insight",
  dataFrame: "Data Frame",
  visualization: "Visualization",
  dashboard: "Dashboard",
};

export const CHANGE_LABELS: Record<PreviewDirectNode["change"], string> = {
  create: "New",
  update: "Changed",
  noop: "Unchanged",
};

export const CHANGE_COLORS: Record<
  PreviewDirectNode["change"],
  "success" | "primary" | "secondary"
> = {
  create: "success",
  update: "primary",
  noop: "secondary",
};

export const FLAG_COLORS: Record<
  PreviewDownstreamNode["flag"],
  "warning" | "secondary" | "danger"
> = {
  recompute: "warning",
  stale: "secondary",
  orphaned: "danger",
};

export const FLAG_LABELS: Record<PreviewDownstreamNode["flag"], string> = {
  recompute: "Will recompute",
  stale: "Stale",
  orphaned: "Orphaned",
};

export type ChangeDetail = {
  key: string;
  before: unknown;
  after: unknown;
};

type NestedCollectionKey = "fields" | "metrics" | "joins";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function comparableBefore(
  before: Record<string, unknown>,
): Record<string, unknown> {
  const definition = isRecord(before.definition) ? before.definition : {};
  // The row-level slice wins so persisted columns override same-named definition keys.
  return { ...definition, ...before };
}

function valuesMatch(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) && Array.isArray(after)) {
    return (
      before.length === after.length &&
      before.every((value, index) => valuesMatch(value, after[index]))
    );
  }
  if (!isRecord(before) || !isRecord(after)) return false;

  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  return (
    beforeKeys.length === afterKeys.length &&
    beforeKeys.every(
      (key) =>
        Object.hasOwn(after, key) && valuesMatch(before[key], after[key]),
    )
  );
}

function redactSecretRefs(value: unknown): unknown {
  if (
    typeof value === "string" &&
    /^secret:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  ) {
    return "••••••";
  }
  if (Array.isArray(value)) return value.map(redactSecretRefs);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactSecretRefs(entry)]),
  );
}

export function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  const redacted = redactSecretRefs(value);
  const serialized =
    typeof redacted === "string"
      ? redacted
      : (JSON.stringify(redacted) ?? String(redacted));
  return serialized.length > 120 ? `${serialized.slice(0, 120)}…` : serialized;
}

function dashboardItemUpdateDetails(
  before: Record<string, unknown>,
  proposed: Record<string, unknown>,
): ChangeDetail[] | null {
  if (typeof proposed.itemId !== "string" || !isRecord(proposed.updates)) {
    return null;
  }
  const layout = comparableBefore(before).layout;
  if (!Array.isArray(layout)) return null;
  const item = layout.find(
    (candidate) => isRecord(candidate) && candidate.id === proposed.itemId,
  );
  if (!isRecord(item)) return null;

  return Object.entries(sanitizeDashboardItemUpdates(proposed.updates))
    .filter(([key, after]) => !valuesMatch(item[key], after))
    .map(([key, after]) => ({ key, before: item[key], after }));
}

function nestedUpdateDetails(
  before: Record<string, unknown>,
  proposed: Record<string, unknown>,
  collectionKey: NestedCollectionKey,
  targetId: unknown,
): ChangeDetail[] | null {
  if (!isRecord(proposed.updates)) return null;
  const target = findNestedTarget(before, collectionKey, targetId);
  if (!target) return null;

  return Object.entries(proposed.updates)
    .filter(([key, after]) => !valuesMatch(target[key], after))
    .map(([key, after]) => ({ key, before: target[key], after }));
}

function findNestedTarget(
  before: Record<string, unknown>,
  collectionKey: NestedCollectionKey,
  targetId: unknown,
): Record<string, unknown> | null {
  const collection = comparableBefore(before)[collectionKey];
  if (!Array.isArray(collection)) return null;

  let target: unknown;
  if (collectionKey === "joins") {
    target = collection[typeof targetId === "number" ? targetId : -1];
  } else {
    target = collection.find((item) => isRecord(item) && item.id === targetId);
  }
  return isRecord(target) ? target : null;
}

function nestedTargetLabel(
  before: Record<string, unknown>,
  collectionKey: NestedCollectionKey,
  targetId: unknown,
): string {
  const kind = collectionKey === "joins" ? "join" : collectionKey.slice(0, -1);
  const target = findNestedTarget(before, collectionKey, targetId);
  if (!target || typeof target.name !== "string") {
    const targetLabel =
      typeof targetId === "string" &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(targetId)
        ? `${targetId.slice(0, 8)}…`
        : targetId;
    return collectionKey === "joins"
      ? `join #${targetId}`
      : `${kind} ${targetLabel}`;
  }

  return `${kind} ${target.name}`;
}

function fallbackUpdateDetails(
  proposed: Record<string, unknown>,
): ChangeDetail[] | null {
  if (!isRecord(proposed.updates)) return null;
  return Object.entries(proposed.updates).map(([key, after]) => ({
    key,
    before: undefined,
    after,
  }));
}

export function getChangeDetails(node: PreviewDirectNode): ChangeDetail[] {
  if (node.before === null || node.change === "noop") return [];

  const { before, proposedDefinition: proposed } = node;
  const dashboardDetails = dashboardItemUpdateDetails(before, proposed);
  if (dashboardDetails !== null) return dashboardDetails;
  const nestedDetails = [
    ["fields", proposed.fieldId],
    ["metrics", proposed.metricId],
    ["joins", proposed.joinIndex],
  ] as const;
  const selectedNestedTargets = nestedDetails.filter(
    ([, target]) => target !== undefined,
  );

  if (selectedNestedTargets.length > 1 && isRecord(proposed.updates)) {
    const label = `one of: ${selectedNestedTargets
      .map(([collection, target]) =>
        nestedTargetLabel(before, collection, target),
      )
      .join(", ")}`;
    return Object.entries(proposed.updates).map(([key, after]) => ({
      key: `${label} — ${key}`,
      before: undefined,
      after,
    }));
  }

  let anyResolved = false;
  const resolvedNestedDetails = selectedNestedTargets.flatMap(
    ([collection, target]) => {
      const details = nestedUpdateDetails(before, proposed, collection, target);
      if (details === null) return [];
      anyResolved = true;
      return details;
    },
  );
  if (anyResolved) return resolvedNestedDetails;

  const fallbackDetails = fallbackUpdateDetails(proposed);
  if (fallbackDetails !== null) return fallbackDetails;

  const canonical = comparableBefore(before);
  const ignoredKeys = new Set([
    "id",
    "nodeId",
    "fieldId",
    "metricId",
    "itemId",
    "dashboardId",
    "joinIndex",
    "sourceItemId",
    "updates",
  ]);
  return Object.entries(proposed)
    .filter(([key]) => !ignoredKeys.has(key))
    .map(([key, after]) => {
      if (key === "spec") {
        return {
          key,
          before: isRecord(canonical.options)
            ? canonical.options.spec
            : undefined,
          after,
        };
      }
      let beforeKey = key;
      if (key === "fieldIds") beforeKey = "selectedFields";
      else if (key === "visualizationType") beforeKey = "chartType";
      return { key: beforeKey, before: canonical[beforeKey], after };
    })
    .filter(
      ({ before: beforeValue, after }) => !valuesMatch(beforeValue, after),
    );
}

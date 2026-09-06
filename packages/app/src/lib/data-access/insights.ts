import type { Insight, UUID } from "@dashframe/types";

import { api } from "@dashframe/convex-backend/api";
import { getConvexClient } from "@/data/runtime";

export async function getInsight(id: UUID): Promise<Insight | undefined> {
  const result = await getConvexClient().query(api.app.getInsight, { id });
  return (result as Insight | null) ?? undefined;
}

export async function getAllInsights(): Promise<Insight[]> {
  const result = await getConvexClient().query(api.app.listInsights, {});
  return result as Insight[];
}

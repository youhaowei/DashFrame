import type { Insight, UUID } from "@dashframe/types";

import { api } from "../../wystack/api";
import { getWyStackClient } from "../../wystack/client";

export async function getInsight(id: UUID): Promise<Insight | undefined> {
  const result = await getWyStackClient().query(api.getInsight, { id });
  return (result as Insight | null) ?? undefined;
}

export async function getAllInsights(): Promise<Insight[]> {
  const result = await getWyStackClient().query(api.listInsights, {});
  return result as Insight[];
}

import { useConnectorCatalog } from "@/data/connector-catalog";
import { queryStatus } from "@/data/query-status";
import { api } from "@dashframe/convex-backend/api";
import type { Command } from "@dashframe/types";
import { useMutation, useQuery_experimental as useQuery } from "convex/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { createWebMCPTools } from "./tools";
import { useWebMCPTools } from "./webmcp";

/**
 * Shared web/Electron capability provider. Browsers without WebMCP, including
 * the Electron renderer, take the feature-detected no-op path in the hook.
 */
export function WebMCPProvider({ children }: { children: ReactNode }) {
  const route = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const connectors = useConnectorCatalog().data;
  const dataSources = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  ).data;
  const dataTables = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  ).data;
  const insights = queryStatus(
    useQuery({ query: api.app.listInsights, args: {} }),
  ).data;
  const visualizations = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  ).data;
  const dashboards = queryStatus(
    useQuery({ query: api.app.listDashboards, args: {} }),
  ).data;
  const draftBatch = useMutation(api.app.draftBatch);

  const tools = useMemo(
    () =>
      createWebMCPTools({
        getData: () => ({
          connectors,
          dataSources,
          dataTables,
          insights,
          visualizations,
          dashboards,
          route,
        }),
        stageDraft: async (commands: readonly Command[]) =>
          draftBatch({ commands: [...commands] }),
        navigateToDraft: (draftId) =>
          navigate({
            to: "/drafts/$draftId",
            params: { draftId },
          }),
        document,
      }),
    [
      connectors,
      dashboards,
      dataSources,
      dataTables,
      draftBatch,
      insights,
      navigate,
      route,
      visualizations,
    ],
  );
  useWebMCPTools(tools);

  return children;
}

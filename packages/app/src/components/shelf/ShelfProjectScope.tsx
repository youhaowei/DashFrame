import { queryStatus } from "@/data/query-status";
import { api } from "@dashframe/convex-backend/api";
import { useQuery_experimental as useQuery } from "convex/react";
import { useEffect } from "react";
import { setShelfProject } from "./shelf-store";

/**
 * Tells the shelf which project is open, so each project keeps its own shelf
 * and another project on the same origin never sees it. Renders nothing.
 */
export function ShelfProjectScope() {
  const { data } = queryStatus(
    useQuery({ query: api.app.projectInfo, args: {} }),
  );
  const projectId = data?.projectId ?? null;
  useEffect(() => {
    setShelfProject(projectId);
  }, [projectId]);
  return null;
}

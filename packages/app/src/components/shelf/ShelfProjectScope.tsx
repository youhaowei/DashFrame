import { queryStatus } from "@/data/query-status";
import { getRuntimeConfig } from "@/data/runtime";
import { api } from "@dashframe/convex-backend/api";
import { useQuery_experimental as useQuery } from "convex/react";
import { useEffect } from "react";
import { setShelfProject } from "./shelf-store";

/** The signed-in account on a hosted deployment; local mode has none. */
function hostedSubject(): string | null {
  try {
    const config = getRuntimeConfig() as { subject?: unknown };
    return typeof config.subject === "string" ? config.subject : null;
  } catch {
    return null;
  }
}

/**
 * Tells the shelf which project, and on a hosted deployment which account,
 * is open, so each keeps its own shelf and nothing carries over to another
 * workspace or another account in the same browser. Renders nothing.
 */
export function ShelfProjectScope() {
  const { data } = queryStatus(
    useQuery({ query: api.app.projectInfo, args: {} }),
  );
  const projectId = data?.projectId ?? null;
  useEffect(() => {
    const subject = hostedSubject();
    setShelfProject(
      projectId && subject ? `${projectId}:${subject}` : projectId,
    );
  }, [projectId]);
  return null;
}

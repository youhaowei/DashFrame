import type { ProjectInfo } from "@dashframe/types";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { transport } from "../transport";

export const Route = createFileRoute("/")({
  component: HelloView,
});

function HelloView() {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    transport
      .invoke("project.info")
      .then((data) => {
        if (!cancelled) setInfo(data as ProjectInfo);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>DashFrame v0.2</h1>
      <p>hello — desktop shell boot</p>
      <ProjectInfoView info={info} error={error} />
    </main>
  );
}

function ProjectInfoView({
  info,
  error,
}: {
  info: ProjectInfo | null;
  error: string | null;
}) {
  if (error)
    return <p style={{ color: "crimson" }}>project.info failed: {error}</p>;
  if (!info) return <p>loading project…</p>;
  return (
    <dl>
      <dt>name</dt>
      <dd>{info.name}</dd>
      <dt>dir</dt>
      <dd>
        <code>{info.dir}</code>
      </dd>
      <dt>projectId</dt>
      <dd>
        <code>{info.projectId}</code>
      </dd>
    </dl>
  );
}

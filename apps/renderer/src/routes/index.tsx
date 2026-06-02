import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@wystack/client";

export const Route = createFileRoute("/")({
  component: HelloView,
});

function HelloView() {
  const { api } = Route.useRouteContext();
  const { data, isLoading, error } = useQuery(api.projectInfo, { args: {} });

  return (
    <main className="p-8 font-sans">
      <h1>DashFrame v0.2</h1>
      <p>hello - desktop shell boot</p>

      {/* Smoke proof (YW-69): a projectInfo query round-trips renderer → loopback
          WyStack HTTP server → PGLite and back. The data-testid node is the
          assertable result for run-the-app verification. */}
      <section data-testid="project-info">
        {isLoading && <p>Loading project…</p>}
        {error && (
          <p data-testid="project-info-error">Error: {error.message}</p>
        )}
        {data && (
          <dl>
            <dt>Project</dt>
            <dd data-testid="project-name">{data.name}</dd>
            <dt>ID</dt>
            <dd data-testid="project-id">{data.projectId}</dd>
            <dt>Version</dt>
            <dd data-testid="project-version">{data.version}</dd>
          </dl>
        )}
      </section>
    </main>
  );
}

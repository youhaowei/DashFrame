import { createFileRoute } from "@tanstack/react-router";
import { useProjectInfo } from "../wystack";

export const Route = createFileRoute("/")({
  component: HelloView,
});

function HelloView() {
  // Fetch project info via WyStack IPC query (YW-69 / T7 smoke test).
  // This call goes over the Electron IPC transport: renderer → preload bridge →
  // ipcMain (wystack:c2s) → WyStack engine → projectInfo handler →
  // ipcMain (wystack:s2c) → renderer.
  const { data, isLoading, isError, error } = useProjectInfo();

  return (
    <main className="p-8 font-sans">
      <h1>DashFrame v0.2</h1>
      {isLoading && <p>Loading project info…</p>}
      {isError && <p style={{ color: "red" }}>Error: {error?.message}</p>}
      {data && (
        <section>
          <p>
            <strong>Project:</strong> {data.name}
          </p>
          <p>
            <strong>Version:</strong> {data.version}
          </p>
          <p>
            <strong>Schema version:</strong> {data.schemaVersion}
          </p>
          <p>
            <strong>Project ID:</strong> {data.projectId}
          </p>
          <p>
            <small>Fetched via WyStack IPC query over Electron transport</small>
          </p>
        </section>
      )}
    </main>
  );
}

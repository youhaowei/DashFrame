import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HelloView,
});

function HelloView() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>DashFrame v0.2</h1>
      <p>hello — desktop shell boot</p>
    </main>
  );
}

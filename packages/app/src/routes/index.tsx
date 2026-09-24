import { createFileRoute, redirect } from "@tanstack/react-router";

// The product is report-first: home is the reports list, whose empty state
// asks for the first report.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboards", replace: true });
  },
});

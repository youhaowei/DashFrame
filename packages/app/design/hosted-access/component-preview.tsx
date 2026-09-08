import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HostedAccessScreen,
  type HostedAccessScreenProps,
} from "../../src/components/hosted-access/HostedAccessScreen";
import "../../src/globals.css";

function Preview() {
  const [status, setStatus] =
    useState<HostedAccessScreenProps["status"]>("signed-out");
  const [dark, setDark] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState("None");
  const onAction = (label: string) => {
    setLastAction(label);
    setBusy(true);
  };
  let props: HostedAccessScreenProps;
  switch (status) {
    case "signed-out":
      props = { status, busy, onSignIn: () => onAction("Sign in") };
      break;
    case "pending-admission":
      props = { status, busy, onSignOut: () => onAction("Sign out") };
      break;
    case "unavailable":
      props = { status, busy, onRetry: () => onAction("Try again") };
      break;
    case "loading":
      props = { status };
      break;
  }

  return (
    <div className={dark ? "dark" : ""}>
      <div className="flex flex-wrap items-center gap-4 border-b border-neutral-border bg-neutral-bg p-4 text-sm text-neutral-fg">
        <label>
          Preview state{" "}
          <select
            value={status}
            onChange={(event) => {
              setStatus(
                event.target.value as HostedAccessScreenProps["status"],
              );
              setBusy(false);
              setLastAction("None");
            }}
          >
            <option value="signed-out">Signed out</option>
            <option value="pending-admission">Pending admission</option>
            <option value="unavailable">Unavailable</option>
            <option value="loading">Loading</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => setDark(event.target.checked)}
          />{" "}
          Dark theme
        </label>
        <label>
          <input
            type="checkbox"
            checked={busy}
            onChange={(event) => setBusy(event.target.checked)}
          />{" "}
          Busy action
        </label>
        <span>Last action: {lastAction}</span>
      </div>
      <HostedAccessScreen {...props} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);

import { Button } from "@wystack/ui-react";
import { useId } from "react";

export type HostedAccessScreenProps =
  | { status: "loading" }
  | { status: "signed-out"; onSignIn: () => void; busy?: boolean }
  | { status: "pending-admission"; onSignOut: () => void; busy?: boolean }
  | { status: "unavailable"; onRetry: () => void; busy?: boolean };

const copy = {
  "signed-out": {
    role: undefined,
    heading: "Sign in to DashFrame",
    description: "A private workspace for your data and reports.",
  },
  "pending-admission": {
    role: undefined,
    heading: "This account doesn’t have access",
    description: "You’re signed in, but DashFrame access is invite-only.",
  },
  unavailable: {
    role: "alert",
    heading: "Couldn’t check access",
    description: "DashFrame couldn’t confirm your access. Try again.",
  },
  loading: {
    role: "status",
    heading: "Checking access…",
    description: "Checking your session and DashFrame access.",
  },
} as const;

const busyLabel = {
  "signed-out": "Signing in…",
  "pending-admission": "Signing out…",
  unavailable: "Retrying access check…",
};

function AccessAction(props: HostedAccessScreenProps) {
  switch (props.status) {
    case "signed-out":
      return (
        <Button
          label="Sign in"
          className="min-w-32"
          onClick={props.onSignIn}
          loading={props.busy}
        />
      );
    case "pending-admission":
      return (
        <Button
          className="min-w-32"
          label="Sign out"
          variant="outline"
          onClick={props.onSignOut}
          loading={props.busy}
        />
      );
    case "unavailable":
      return (
        <Button
          className="min-w-32"
          label="Try again"
          onClick={props.onRetry}
          loading={props.busy}
        />
      );
    case "loading":
      return null;
  }
}

/** Displays a host-resolved access state. The caller owns verification and actions. */
export function HostedAccessScreen(props: HostedAccessScreenProps) {
  const headingId = useId();
  const { heading, description, role } = copy[props.status];

  return (
    <main className="flex min-h-svh items-center justify-center bg-neutral-bg-subtle px-4 py-8 text-neutral-fg">
      <section
        aria-labelledby={headingId}
        className="flex min-h-88 w-full max-w-sm flex-col rounded-xl border border-neutral-border bg-neutral-bg p-6 sm:p-8"
      >
        <p className="mb-8 text-sm font-semibold tracking-tight">DashFrame</p>
        <div role={role} aria-atomic={role ? true : undefined}>
          <h1
            id={headingId}
            className="text-2xl leading-tight font-semibold tracking-tight"
          >
            {heading}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-fg-subtle">
            {description}
          </p>
        </div>
        {props.status !== "loading" && (
          <div className="mt-6 flex">
            <AccessAction {...props} />
            <p role="status" className="sr-only">
              {props.busy ? busyLabel[props.status] : ""}
            </p>
          </div>
        )}
        {props.status === "signed-out" && (
          <p className="mt-5 text-xs leading-relaxed text-neutral-fg-subtle">
            Access is currently invite-only.
          </p>
        )}
      </section>
    </main>
  );
}

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  HostedAccessScreen,
  type HostedAccessScreenProps,
} from "./HostedAccessScreen";

afterEach(cleanup);

const actions: {
  status: string;
  label: string;
  busyLabel: string;
  props: (onAction: () => void, busy: boolean) => HostedAccessScreenProps;
}[] = [
  {
    status: "signed out",
    label: "Sign in",
    busyLabel: "Signing in…",
    props: (onSignIn, busy) => ({ status: "signed-out", onSignIn, busy }),
  },
  {
    status: "pending admission",
    label: "Sign out",
    busyLabel: "Signing out…",
    props: (onSignOut, busy) => ({
      status: "pending-admission",
      onSignOut,
      busy,
    }),
  },
  {
    status: "unavailable",
    label: "Try again",
    busyLabel: "Retrying access check…",
    props: (onRetry, busy) => ({ status: "unavailable", onRetry, busy }),
  },
];

describe("HostedAccessScreen", () => {
  it.each(actions)(
    "offers only the $label action when $status and blocks it while busy",
    async ({ label, busyLabel, props }) => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      const { rerender } = render(
        <HostedAccessScreen {...props(onAction, false)} />,
      );
      const button = screen.getByRole("button", {
        name: label,
      }) as HTMLButtonElement;
      expect(screen.getAllByRole("button")).toHaveLength(1);
      expect(onAction).not.toHaveBeenCalled();

      await user.tab();
      expect(document.activeElement).toBe(button);
      await user.keyboard("{Enter}");
      expect(onAction).toHaveBeenCalledTimes(1);

      rerender(<HostedAccessScreen {...props(onAction, true)} />);
      expect(button.disabled).toBe(true);
      expect(screen.getByRole("status").textContent).toBe(busyLabel);
      await user.click(button);
      expect(onAction).toHaveBeenCalledTimes(1);

      rerender(<HostedAccessScreen {...props(onAction, false)} />);
      expect(button.disabled).toBe(false);
      expect(screen.getByRole("status").textContent).toBe("");
      await user.click(button);
      expect(onAction).toHaveBeenCalledTimes(2);
    },
  );

  it("announces loading and replaces the previous action while access is checked", () => {
    const { rerender } = render(
      <HostedAccessScreen status="signed-out" onSignIn={vi.fn()} />,
    );
    rerender(<HostedAccessScreen status="loading" />);
    expect(screen.getByRole("status").textContent).toContain("Checking access");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("distinguishes authenticated denial from an unavailable access check", () => {
    const { rerender } = render(
      <HostedAccessScreen status="pending-admission" onSignOut={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "This account doesn’t have access",
    );
    expect(screen.getByText(/You’re signed in/).textContent).toContain(
      "invite-only",
    );
    expect(
      screen.queryByRole("button", { name: "Sign in", exact: true }),
    ).toBeNull();

    rerender(<HostedAccessScreen status="unavailable" onRetry={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "couldn’t confirm your access",
    );
    expect(screen.queryByText(/You’re signed in/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sign in", exact: true }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sign out", exact: true }),
    ).toBeNull();
  });
});

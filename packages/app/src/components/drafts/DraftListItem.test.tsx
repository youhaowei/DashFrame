import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DraftListItem } from "./DraftListItem";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children?: ReactNode;
    to: string;
    params?: { draftId: string };
  }) => (
    <a href={to.replace("$draftId", params?.draftId ?? "")} {...props}>
      {children}
    </a>
  ),
}));

describe("DraftListItem discard confirmation", () => {
  it("keeps opening the menu and cancelling separate from discarding a draft", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    const draft = {
      draftId: "draft-1",
      commandCount: 2,
      createdAt: new Date(),
      updatedAt: null,
      paths: ["insights/revenue"],
      kinds: {},
    };
    render(<DraftListItem draft={draft} onDiscard={onDiscard} />);

    expect(
      screen.getByRole("link", { name: /2 changes/ }).getAttribute("href"),
    ).toBe("/drafts/draft-1");
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Discard draft" }),
    );
    expect(onDiscard).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDiscard).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Discard draft" }),
    );
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith(draft);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { requireWorkspaceOwner } from "./context";

describe("workspace owner management authority", () => {
  it("admits only the server-bound personal workspace owner", () => {
    expect(() =>
      requireWorkspaceOwner({
        principal: { kind: "user", userId: "owner-a" },
        workspaceOwnerId: "owner-a",
      }),
    ).not.toThrow();
    for (const userId of ["owner-b", "local-user"])
      expect(() =>
        requireWorkspaceOwner({
          principal: { kind: "user", userId },
          workspaceOwnerId: "owner-a",
        }),
      ).toThrow("FORBIDDEN");
    expect(() =>
      requireWorkspaceOwner({
        principal: { kind: "service", credentialId: "owner-a" },
        workspaceOwnerId: "owner-a",
      }),
    ).toThrow("FORBIDDEN");
  });
  it("retains the local operator boundary and rejects malformed hosted ownership", () => {
    expect(() =>
      requireWorkspaceOwner({
        principal: { kind: "user", userId: "local-user" },
      }),
    ).not.toThrow();
    expect(() =>
      requireWorkspaceOwner({ principal: { kind: "user", userId: "owner-a" } }),
    ).toThrow("FORBIDDEN");
    for (const workspaceOwnerId of ["", " ", "owner a", "owner-a\n"])
      expect(() =>
        requireWorkspaceOwner({
          principal: { kind: "user", userId: workspaceOwnerId },
          workspaceOwnerId,
        }),
      ).toThrow("FORBIDDEN");
  });
});

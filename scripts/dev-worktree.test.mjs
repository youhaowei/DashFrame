import { describe, expect, test } from "bun:test";

import { createDevIdentity, sanitizeHostnameLabel } from "./dev-worktree.mjs";

describe("worktree dev identity", () => {
  test("keeps the main checkout on the short canonical name", () => {
    expect(createDevIdentity({ root: "/repo", isMainWorktree: true })).toEqual({
      id: "main",
      name: "dashframe",
    });
  });

  test("gives detached worktrees stable collision-free names", () => {
    const first = createDevIdentity({ root: "/tasks/alpha/DashFrame" });
    const repeated = createDevIdentity({ root: "/tasks/alpha/DashFrame" });
    const second = createDevIdentity({ root: "/tasks/beta/DashFrame" });

    expect(first).toEqual(repeated);
    expect(first.name).toMatch(/^dashframe-alpha-[a-f0-9]{6}$/);
    expect(second.name).toMatch(/^dashframe-beta-[a-f0-9]{6}$/);
    expect(first.name).not.toBe(second.name);
  });

  test("preserves the path hash when long worktree hints are truncated", () => {
    const sharedPrefix = "a".repeat(60);
    const first = createDevIdentity({
      root: `/tasks/${sharedPrefix}-one/DashFrame`,
    });
    const second = createDevIdentity({
      root: `/tasks/${sharedPrefix}-two/DashFrame`,
    });

    expect(first.name).toHaveLength(63);
    expect(second.name).toHaveLength(63);
    expect(first.name).not.toBe(second.name);
    expect(first.name).toMatch(/-[a-f0-9]{6}$/);
    expect(second.name).toMatch(/-[a-f0-9]{6}$/);
  });

  test("sanitizes an explicit agent-friendly name", () => {
    expect(
      createDevIdentity({
        root: "/repo",
        explicitName: "Task 788 / Source Binding",
      }).name,
    ).toBe("task-788-source-binding");
  });

  test("bounds explicit names to one DNS label", () => {
    const { name } = createDevIdentity({
      root: "/repo",
      explicitName: "x".repeat(80),
    });
    expect(name).toHaveLength(63);
  });

  test("produces valid hostname labels", () => {
    expect(sanitizeHostnameLabel(" Codex/Feature__One ")).toBe(
      "codex-feature-one",
    );
  });
});

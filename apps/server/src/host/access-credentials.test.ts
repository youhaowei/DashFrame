import { describe, expect, it } from "vite-plus/test";

import { getAccessCapabilities } from "./access-credentials";
import type { HostContext } from "./context";

const store = {
  issue: async () => ({}),
  list: async () => [],
  revoke: async () => true,
};

function context(overrides: Partial<HostContext>): HostContext {
  return {
    principal: { kind: "user", userId: "local-user" },
    ...overrides,
  } as unknown as HostContext;
}

describe("getAccessCapabilities", () => {
  it("lets the owner manage credentials when the host has a secret key", async () => {
    expect(
      await getAccessCapabilities(
        context({
          accessCredentials:
            store as unknown as HostContext["accessCredentials"],
        }),
      ),
    ).toEqual({ canManageCredentials: true });
  });

  it("names the missing secret key when the host has no credential store", async () => {
    expect(await getAccessCapabilities(context({}))).toEqual({
      canManageCredentials: false,
      unavailableReason: "no-secret-key",
    });
  });

  it("tells a non-owner they are not the owner once the host has a key", async () => {
    expect(
      await getAccessCapabilities(
        context({
          principal: { kind: "user", userId: "someone-else" },
          accessCredentials:
            store as unknown as HostContext["accessCredentials"],
        } as Partial<HostContext>),
      ),
    ).toEqual({ canManageCredentials: false, unavailableReason: "not-owner" });
  });

  // An unprotected loopback host serves everyone as an anonymous user; the
  // missing key is still the fact that blocks credentials and sign-ins.
  it("reports the missing key before ownership", async () => {
    expect(
      await getAccessCapabilities(
        context({
          principal: { kind: "user", userId: "loopback-anonymous" },
        } as Partial<HostContext>),
      ),
    ).toEqual({
      canManageCredentials: false,
      unavailableReason: "no-secret-key",
    });
  });

  it("names the missing host token when a keyed loopback host serves anonymously", async () => {
    expect(
      await getAccessCapabilities(
        context({
          principal: { kind: "user", userId: "loopback-anonymous" },
          accessCredentials:
            store as unknown as HostContext["accessCredentials"],
        } as Partial<HostContext>),
      ),
    ).toEqual({
      canManageCredentials: false,
      unavailableReason: "no-host-token",
    });
  });
});

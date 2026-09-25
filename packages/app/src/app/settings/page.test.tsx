import {
  hostMutationMock,
  hostQueryMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  mockHost,
  mockClearAllData,
  mockReloadRoot,
  mockRevoke,
  mockRefetch,
  mockShowError,
} = vi.hoisted(() => ({
  mockHost: {
    capabilities: { canManageCredentials: true } as {
      canManageCredentials: boolean;
      unavailableReason?: "not-owner" | "no-secret-key" | "no-host-token";
    },
    credentials: [] as unknown[],
    listFails: false,
    runtime: { url: "http://127.0.0.1:4000", mode: "local" } as {
      url: string;
      mode?: "local" | "hosted";
    },
  },
  mockClearAllData: vi.fn(),
  mockReloadRoot: vi.fn(),
  mockRevoke: vi.fn(),
  mockRefetch: vi.fn(),
  mockShowError: vi.fn(),
}));

const SOURCES = [
  {
    id: "src-local",
    type: "local",
    name: "Local Files",
    config: { hasApiKey: false, hasConnectionString: false },
    createdAt: 1,
  },
  {
    id: "src-pg",
    type: "postgres",
    name: "Warehouse",
    config: { hasApiKey: false, hasConnectionString: true },
    createdAt: 2,
  },
];
const TABLES = [
  {
    id: "t1",
    dataSourceId: "src-local",
    fields: [
      { id: "f1", name: "email", sensitivity: "sensitive" },
      { id: "f2", name: "region" },
      { id: "f3", name: "amount", sensitivity: "cleared" },
    ],
  },
  {
    id: "t2",
    dataSourceId: "src-pg",
    fields: [{ id: "f4", name: "order_id", sensitivity: "unclassified" }],
  },
];

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (mockHost.failingQueries.includes(ref._path))
      return { isError: true, error: new Error("query failed") };
    if (ref._path === "projectInfo")
      return { data: { projectId: "p1", name: "Acme analytics" } };
    if (ref._path === "listDataSources")
      return { data: mockHost.sources ?? SOURCES };
    if (ref._path === "listDataTables") return { data: TABLES };
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
  useConvexConnectionState: () => ({ isWebSocketConnected: true }),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock((ref: { _path: string }) => {
    if (ref._path === "getAccessCapabilities")
      return { data: mockHost.capabilities, isLoading: false };
    if (ref._path === "listAccessCredentials") {
      if (!mockHost.capabilities.canManageCredentials)
        throw new Error("listAccessCredentials needs a secret key");
      if (mockHost.listFails)
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: mockRefetch,
        };
      return {
        data: mockHost.credentials,
        isLoading: false,
        refetch: mockRefetch,
      };
    }
    if (ref._path === "getAccessConnectionInfo")
      return { data: undefined, isLoading: false };
    throw new Error(`Unexpected host query: ${ref._path}`);
  }),
  useHostMutation: hostMutationMock((ref: { _path: string }) => ({
    mutateAsync: ref._path === "revokeAccessCredential" ? mockRevoke : vi.fn(),
  })),
}));
vi.mock("@/data/runtime", () => ({
  getRuntimeConfig: () => mockHost.runtime,
}));
vi.mock("@/lib/platform", () => ({
  usePlatform: () => ({ isMacOS: true, isElectron: false }),
}));
vi.mock("@/lib/stores", () => ({
  useToastStore: () => ({ showError: mockShowError, showSuccess: vi.fn() }),
}));
vi.mock("@/lib/data-access/data-frames", () => ({
  clearAllData: mockClearAllData,
}));
vi.mock("@/lib/clear-all-data-navigation", () => ({
  reloadRootWithFreshWorkspaceState: mockReloadRoot,
}));
// The theme controls are stdui's own and tested there; here only their place.
vi.mock("@wystack/ui-react/views", () => ({
  ThemePanel: ({ inline }: { inline?: boolean }) => (
    <div data-testid="theme-panel" data-inline={String(inline)} />
  ),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { SignOutProvider } from "@/bootstrap/sign-out";
import { UsageAnalyticsProvider } from "@/lib/usage-analytics";
import SettingsPage from "./page";

function section(name: string) {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  mockHost.capabilities = { canManageCredentials: true };
  mockHost.credentials = [];
  mockHost.listFails = false;
  mockHost.failingQueries = [];
  mockHost.sources = null;
  mockHost.runtime = { url: "http://127.0.0.1:4000", mode: "local" };
  delete (window as { dashframe?: unknown }).dashframe;
  mockClearAllData.mockReset().mockResolvedValue(undefined);
  mockShowError.mockReset();
  mockReloadRoot.mockReset();
  mockRevoke.mockReset().mockResolvedValue(undefined);
});

describe("SettingsPage", () => {
  it("stacks every section, in order, with a jump chip for each", () => {
    render(<SettingsPage />);
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Appearance", "Project", "Credentials", "Privacy", "About"]);
    expect(
      within(screen.getByRole("navigation", { name: "Jump to section" }))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Appearance", "Project", "Credentials", "Privacy", "About"]);

    expect(
      within(section("Appearance")).getByTestId("theme-panel").dataset.inline,
    ).toBe("true");
    expect(within(section("Project")).getByText("Acme analytics")).toBeTruthy();
    expect(
      within(section("Project")).getByText("http://127.0.0.1:4000"),
    ).toBeTruthy();
    expect(within(section("About")).getByText("Connected")).toBeTruthy();
    expect(
      within(section("About"))
        .getByRole("link", { name: /Open source on GitHub/ })
        .getAttribute("href"),
    ).toBe("https://github.com/youhaowei/dashframe");
  });

  it("offers no folder action where the host shell cannot reveal it", () => {
    render(<SettingsPage />);
    expect(
      within(section("Project")).queryByRole("button", {
        name: "Show in Finder",
      }),
    ).toBeNull();
  });

  it("reveals the project folder where the desktop shell can", () => {
    const revealFolder = vi.fn().mockResolvedValue(undefined);
    (window as { dashframe?: unknown }).dashframe = {
      project: { revealFolder },
    };
    render(<SettingsPage />);
    fireEvent.click(
      within(section("Project")).getByRole("button", {
        name: "Show in Finder",
      }),
    );
    expect(revealFolder).toHaveBeenCalledOnce();
  });

  it("names the operator's services on a hosted deployment, and analytics when sent", () => {
    mockHost.runtime = { url: "https://dashframe.dev", mode: "hosted" };
    render(
      <UsageAnalyticsProvider service="PostHog">
        <SettingsPage />
      </UsageAnalyticsProvider>,
    );
    const privacy = section("Privacy");
    expect(privacy.textContent).toContain(
      "This workspace runs on operator-managed services",
    );
    expect(privacy.textContent).toContain("WorkOS");
    expect(privacy.textContent).not.toContain("stays on the host");
    expect(privacy.textContent).toContain(
      "This web app sends usage analytics to PostHog",
    );
  });

  it("claims nothing about data leaving when the host did not say its kind", () => {
    mockHost.runtime = { url: "http://127.0.0.1:4000" };
    render(<SettingsPage />);
    const privacy = section("Privacy");
    expect(privacy.textContent).not.toContain("stays on the host");
    expect(privacy.textContent).not.toContain("operator-managed");
  });

  it("rolls field classification up per data source", () => {
    render(<SettingsPage />);
    const privacy = section("Privacy");
    expect(privacy.textContent).toContain(
      "3restricted fields across 2 data sources",
    );
    expect(
      within(privacy).getByText(
        "1 sensitive · 1 unclassified · 1 not sensitive",
      ),
    ).toBeTruthy();
    expect(
      within(privacy).getByText(
        "0 sensitive · 1 unclassified · 0 not sensitive",
      ),
    ).toBeTruthy();
    expect(
      within(privacy)
        .getByRole("link", { name: "Review fields in Warehouse" })
        .getAttribute("href"),
    ).toBe("/data-sources/src-pg");
    expect(
      within(privacy).getByText(/Your data stays on the host/),
    ).toBeTruthy();
  });

  it.each(["listDataTables", "listDataSources"])(
    "says field classification failed to load when %s fails, not that it is loading",
    (query) => {
      mockHost.failingQueries = [query];
      render(<SettingsPage />);
      const privacy = section("Privacy");
      expect(within(privacy).queryByText("Loading…")).toBeNull();
      expect(within(privacy).getByRole("alert").textContent).toBe(
        "Couldn't load field classification.",
      );
    },
  );

  it("says the sign-in list failed to load instead of dropping it", () => {
    mockHost.failingQueries = ["listDataSources"];
    render(<SettingsPage />);
    const credentials = section("Credentials");
    expect(
      within(credentials)
        .getAllByRole("alert")
        .map((alert) => alert.textContent),
    ).toContain("Couldn't load data source sign-ins.");
    expect(
      within(credentials).queryByText("No data source has a stored sign-in."),
    ).toBeNull();
  });

  it("says no data source has a sign-in when none does", () => {
    mockHost.sources = [SOURCES[0]];
    render(<SettingsPage />);
    expect(
      within(section("Credentials")).getByText(
        "No data source has a stored sign-in.",
      ),
    ).toBeTruthy();
  });

  it("says so when no credentials are stored", () => {
    render(<SettingsPage />);
    const credentials = section("Credentials");
    expect(
      within(credentials).getByText("No access credentials issued."),
    ).toBeTruthy();
    expect(
      within(credentials).getByRole("button", { name: "Issue credential…" }),
    ).toBeTruthy();
    // The sign-in list names data sources that hold one, and only those.
    expect(
      within(credentials).getByRole("link", { name: "Warehouse" }),
    ).toBeTruthy();
    expect(within(credentials).queryByText("Local Files")).toBeNull();
    expect(screen.queryByTestId("jump-attention-credentials")).toBeNull();
  });

  it("reports a failed list instead of an empty one", () => {
    mockHost.listFails = true;
    render(<SettingsPage />);
    const credentials = section("Credentials");
    expect(
      within(credentials).queryByText("No access credentials issued."),
    ).toBeNull();
    expect(within(credentials).getByRole("alert").textContent).toBe(
      "Couldn't load access credentials.",
    );
    fireEvent.click(
      within(credentials).getByRole("button", { name: "Try again" }),
    );
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("lists active access credentials and revokes one", async () => {
    mockHost.credentials = [
      {
        id: "c1",
        name: "Reporting client",
        tokenPrefix: "dfa_12",
        createdAt: Date.UTC(2026, 8, 1),
      },
      {
        id: "c2",
        name: "Old laptop",
        tokenPrefix: "dfa_34",
        createdAt: Date.UTC(2026, 7, 1),
        revokedAt: Date.UTC(2026, 7, 2),
      },
    ];
    render(<SettingsPage />);
    const credentials = section("Credentials");
    expect(within(credentials).getByText("Reporting client")).toBeTruthy();
    expect(within(credentials).queryByText("Old laptop")).toBeNull();

    fireEvent.click(
      within(credentials).getByRole("button", { name: "Revoke" }),
    );
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith({ id: "c1" }));
  });

  it("explains a missing secret key and marks its jump chip", () => {
    mockHost.capabilities = {
      canManageCredentials: false,
      unavailableReason: "no-secret-key",
    };
    render(<SettingsPage />);
    const credentials = section("Credentials");
    const status = within(credentials).getByRole("status");
    expect(status.textContent).toContain(
      "Credentials are unavailable: no secret key configured",
    );
    expect(status.textContent).toContain("DASHFRAME_SECRET_KEY");
    expect(status.textContent).toContain("DASHFRAME_SECRET_KEY_FILE");
    expect(
      (
        within(status).getByRole("textbox", {
          name: "Command that generates a secret key",
        }) as HTMLInputElement
      ).value,
    ).toBe("openssl rand -base64 32");
    expect(
      within(status).getByRole("button", { name: "Copy command" }),
    ).toBeTruthy();
    expect(
      within(credentials).queryByText("No access credentials issued."),
    ).toBeNull();

    const chip = within(
      screen.getByRole("navigation", { name: "Jump to section" }),
    ).getByRole("button", { name: /Credentials/ });
    expect(chip.textContent).toContain("needs attention");
    expect(screen.getByTestId("jump-attention-credentials")).toBeTruthy();
  });

  it("does not blame the secret key when the caller is not the owner", () => {
    mockHost.capabilities = {
      canManageCredentials: false,
      unavailableReason: "not-owner",
    };
    render(<SettingsPage />);
    const credentials = section("Credentials");
    expect(within(credentials).queryByRole("status")).toBeNull();
    expect(
      within(credentials).getByText(
        "Only the workspace owner can manage access credentials.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("jump-attention-credentials")).toBeNull();
  });

  it("points an anonymous loopback host at its missing token", () => {
    mockHost.capabilities = {
      canManageCredentials: false,
      unavailableReason: "no-host-token",
    };
    render(<SettingsPage />);
    const credentials = section("Credentials");
    expect(credentials.textContent).toContain(
      "Access credentials need a host started with an access token",
    );
    expect(credentials.textContent).not.toContain("workspace owner");
    expect(screen.queryByTestId("jump-attention-credentials")).toBeNull();
  });

  it("asks before clearing all data, then reloads fresh", async () => {
    render(<SettingsPage />);
    fireEvent.click(
      within(section("Project")).getByRole("button", {
        name: "Clear all data…",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Clear all data?")).toBeTruthy();
    expect(mockClearAllData).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Clear all data" }),
    );
    await waitFor(() => expect(mockClearAllData).toHaveBeenCalledOnce());
    expect(mockReloadRoot).toHaveBeenCalledOnce();
  });

  it("reports a failed clear in plain words, keeping the host's error out of the page", async () => {
    mockClearAllData.mockRejectedValue(
      new Error("SQLITE_BUSY: database is locked"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render(<SettingsPage />);
    fireEvent.click(
      within(section("Project")).getByRole("button", {
        name: "Clear all data…",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Clear all data" }),
    );
    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith("Failed to clear data", {
        description: "Try again. If it keeps failing, check the host logs.",
      }),
    );
    expect(JSON.stringify(mockShowError.mock.calls)).not.toContain(
      "SQLITE_BUSY",
    );
    expect(consoleError).toHaveBeenCalled();
    expect(mockReloadRoot).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("adds an Account section with sign out only when the host has accounts", () => {
    const onSignOut = vi.fn();
    render(
      <SignOutProvider onSignOut={onSignOut}>
        <SettingsPage />
      </SignOutProvider>,
    );
    fireEvent.click(
      within(section("Account")).getByRole("button", { name: "Sign out" }),
    );
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

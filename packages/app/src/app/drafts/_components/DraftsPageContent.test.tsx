import {
  nativeMutationMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
/**
 * DraftsPageContent — the drafts workbench.
 *
 * - Tabs: every draft waiting for review fills the top bar; the open tab
 *   follows the URL and falls back to the most recent draft; closing a tab
 *   hides it without discarding the draft.
 * - Centre: the open draft's changes, with late-bound values filled in under
 *   the change that needs them; an empty state when nothing waits.
 * - Panes: the left pane holds the draft's origin and status; the right pane
 *   exists only while a change is selected, and removes its steps.
 * - Lifecycle: publish and discard still reach their mutations.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  mockListDrafts,
  mockReview,
  mockPublish,
  mockDiscard,
  mockRevise,
  mockNavigate,
  mockClientQuery,
} = vi.hoisted(() => ({
  mockListDrafts: vi.fn(),
  mockReview: vi.fn(),
  mockPublish: vi.fn(),
  mockDiscard: vi.fn(),
  mockRevise: vi.fn(),
  mockNavigate: vi.fn(),
  mockClientQuery: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(
    (ref: { _path: string }, options?: { args: unknown }) => {
      if (ref._path === "listDrafts") return mockListDrafts();
      if (ref._path === "draftPublishReview")
        return mockReview((options!.args as { draftId: string }).draftId);
      throw new Error(`Unexpected query: ${ref._path}`);
    },
  ),
  useMutation: nativeMutationMock((ref: { _path: string }) => {
    const mutations: Record<string, unknown> = {
      publishDraft: mockPublish,
      discardDraft: mockDiscard,
      reviseDraft: mockRevise,
    };
    if (!(ref._path in mutations))
      throw new Error(`Unexpected mutation: ${ref._path}`);
    return { mutateAsync: mutations[ref._path] };
  }),
}));

vi.mock("@/data/runtime", () => ({
  getConvexClient: () => ({ query: mockClientQuery }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// The app shell's chrome is not under test; render the page body directly.
vi.mock("@/components/layouts/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => mockNavigate,
}));

import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  TopBarTabsProvider,
  useRegisteredTopBarTabs,
} from "@/components/shell/topbar-tabs";
import { PlatformProvider } from "@/lib/platform";
import { useConfirmDialogStore } from "@/lib/stores";
import { useShellStore } from "@/lib/stores/shell-store";
import { useClosedDraftTabs } from "./closed-draft-tabs";
import DraftsPageContent from "./DraftsPageContent";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OLDER = {
  draftId: "draft-older",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  commandCount: 1,
  kinds: { renameNode: 1 },
  paths: ["renameNode"],
  title: 'Rename to "Orders 2026"',
  createdBy: "user" as const,
};
const NEWER = {
  draftId: "draft-newer",
  createdAt: "2026-09-02T10:00:00.000Z",
  updatedAt: "2026-09-03T10:00:00.000Z",
  commandCount: 2,
  kinds: { createInsightCmd: 1, setInsightFilter: 1 },
  paths: ["createInsightCmd", "setInsightFilter"],
  title: 'Create question "Revenue by region"',
  createdBy: "service" as const,
};

const INSIGHT_ID = "11111111-1111-4111-8111-111111111111";

/** A new insight with a filter whose value the agent left to the reviewer. */
function newerReview() {
  return {
    draftId: NEWER.draftId,
    commands: [
      { path: "createInsightCmd", hasArgs: true, lateBoundCount: 0 },
      {
        path: "setInsightFilter",
        hasArgs: true,
        lateBoundCount: 1,
      },
    ],
    commandCount: 2,
    logSignature: "sig-newer",
    revision: 1,
    diff: {
      mode: "preview",
      directNodes: [
        {
          nodeId: INSIGHT_ID,
          kind: "insight",
          name: "Revenue by region",
          change: "create",
          intent: [
            {
              command: "CreateInsight",
              summary: 'Create question "Revenue by region"',
              commandIndex: 0,
            },
            {
              command: "SetInsightFilter",
              summary: "Update filters",
              commandIndex: 1,
            },
          ],
          before: null,
          proposedDefinition: {},
        },
      ],
      affectedDownstream: [],
      tablesWritten: [],
    },
    lateBound: [
      {
        commandIndex: 1,
        path: "setInsightFilter",
        jsonPath: "$.filters[0].value",
        kind: "value",
        label: "Region",
        refType: "placeholder",
      },
    ],
    publishBlocked: true,
    draftExists: true,
  };
}

function olderReview() {
  return {
    draftId: OLDER.draftId,
    commands: [{ path: "renameNode", hasArgs: true, lateBoundCount: 0 }],
    commandCount: 1,
    logSignature: "sig-older",
    revision: 1,
    diff: {
      mode: "preview",
      directNodes: [
        {
          nodeId: "22222222-2222-4222-8222-222222222222",
          kind: "dataTable",
          name: "Orders",
          change: "update",
          intent: [
            {
              command: "RenameNode",
              summary: 'Rename to "Orders 2026"',
              commandIndex: 0,
            },
          ],
          before: { name: "Orders" },
          proposedDefinition: { name: "Orders 2026" },
        },
      ],
      affectedDownstream: [],
      tablesWritten: [],
    },
    lateBound: [],
    publishBlocked: false,
    draftExists: true,
  };
}

function givenDrafts(drafts: Array<typeof OLDER | typeof NEWER>) {
  const reviews: Record<string, unknown> = {
    [OLDER.draftId]: olderReview(),
    [NEWER.draftId]: newerReview(),
  };
  mockListDrafts.mockReturnValue({ data: drafts });
  mockReview.mockImplementation((draftId: string) => ({
    data: reviews[draftId],
  }));
}

/** Mirrors the top-bar slot: what the page registered, as clickable tabs. */
function TopBarProbe() {
  const tabs = useRegisteredTopBarTabs();
  if (!tabs) return <p data-testid="no-tabs" />;
  return (
    <div role="tablist" aria-label={tabs.label}>
      {tabs.tabs.map((tab) => (
        <span key={tab.id}>
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === tabs.activeId}
            onClick={() => tabs.onSelect(tab.id)}
          >
            {tab.label}
          </button>
          {tab.closable && (
            <button type="button" onClick={() => tabs.onClose?.(tab.id)}>
              Close {tab.label}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** The routes' part: the open draft lives in the URL, here in state. */
function Page({ initialDraftId = null }: { initialDraftId?: string | null }) {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  mockNavigate.mockImplementation(
    (to: { to: string; params?: { draftId: string } }) => {
      if (to.to === "/drafts/$draftId") setDraftId(to.params!.draftId);
      else if (to.to === "/drafts") setDraftId(null);
    },
  );
  return (
    <PlatformProvider>
      <TopBarTabsProvider>
        <TopBarProbe />
        <DraftsPageContent draftId={draftId} />
        <ConfirmDialog />
      </TopBarTabsProvider>
    </PlatformProvider>
  );
}

const tabs = () => within(screen.getByRole("tablist", { name: "Drafts" }));
const inspector = () => screen.queryByRole("heading", { name: "Change" });

beforeEach(() => {
  vi.clearAllMocks();
  useConfirmDialogStore.getState().close();
  useShellStore.setState({ workbenchPanes: {} });
  useClosedDraftTabs.setState({ closed: new Set() });
  mockRevise.mockResolvedValue(null);
  mockPublish.mockResolvedValue(null);
  mockDiscard.mockResolvedValue(null);
  mockClientQuery.mockResolvedValue([]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DraftsPageContent — draft tabs", () => {
  it("puts one tab per draft, oldest first, and opens the most recent", () => {
    givenDrafts([NEWER, OLDER]);
    render(<Page />);

    expect(
      tabs()
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual([OLDER.title, NEWER.title]);
    expect(
      tabs()
        .getByRole("tab", { name: NEWER.title })
        .getAttribute("aria-selected"),
    ).toBe("true");
    screen.getByRole("tabpanel", { name: NEWER.title });
    screen.getByRole("heading", { level: 1, name: NEWER.title });
  });

  it("opens the draft named in the URL, and another when its tab is chosen", async () => {
    givenDrafts([OLDER, NEWER]);
    render(<Page initialDraftId={OLDER.draftId} />);
    screen.getByRole("tabpanel", { name: OLDER.title });

    await userEvent.click(tabs().getByRole("tab", { name: NEWER.title }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/drafts/$draftId",
      params: { draftId: NEWER.draftId },
      replace: true,
    });
    screen.getByRole("tabpanel", { name: NEWER.title });
  });

  it("falls back to the most recent draft when the URL names one that is gone", () => {
    givenDrafts([OLDER, NEWER]);
    render(<Page initialDraftId="draft-published" />);

    screen.getByRole("tabpanel", { name: NEWER.title });
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/drafts/$draftId",
      params: { draftId: NEWER.draftId },
      replace: true,
    });
  });

  it("keeps the open draft when another one is updated in the background", async () => {
    givenDrafts([OLDER, NEWER]);
    const { rerender } = render(<Page />);
    screen.getByRole("tabpanel", { name: NEWER.title });

    // The older draft is revised by its agent and becomes the most recent.
    mockListDrafts.mockReturnValue({
      data: [{ ...OLDER, updatedAt: "2026-09-04T10:00:00.000Z" }, NEWER],
    });
    await act(async () => rerender(<Page />));

    screen.getByRole("tabpanel", { name: NEWER.title });
  });

  it("tells apart drafts that start with the same change", () => {
    const twin = {
      ...NEWER,
      draftId: "draft-twin",
      createdAt: "2026-09-02T15:30:00.000Z",
    };
    givenDrafts([NEWER, twin, OLDER]);
    render(<Page />);

    const labels = tabs()
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(labels[0]).toBe(OLDER.title);
    expect(labels[1]).toMatch(new RegExp(`^${NEWER.title} · `));
    expect(labels[2]).toMatch(new RegExp(`^${NEWER.title} · `));
    expect(labels[1]).not.toBe(labels[2]);
  });

  it("closes a tab without discarding its draft", async () => {
    givenDrafts([OLDER, NEWER]);
    render(<Page />);

    await userEvent.click(
      screen.getByRole("button", { name: `Close ${NEWER.title}` }),
    );

    expect(
      tabs()
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual([OLDER.title]);
    screen.getByRole("tabpanel", { name: OLDER.title });
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it("offers the closed drafts back once every tab is closed", async () => {
    givenDrafts([NEWER]);
    render(<Page />);

    await userEvent.click(
      screen.getByRole("button", { name: `Close ${NEWER.title}` }),
    );
    screen.getByRole("heading", { name: "No drafts open" });
    screen.getByTestId("no-tabs");

    await userEvent.click(screen.getByRole("button", { name: "Open drafts" }));
    screen.getByRole("tabpanel", { name: NEWER.title });
  });
});

describe("DraftsPageContent — empty and loading states", () => {
  it("says where drafts come from when none are waiting, with no action", () => {
    givenDrafts([]);
    render(<Page />);

    screen.getByRole("heading", { name: "No changes waiting for review" });
    screen.getByText(/When an agent proposes changes/);
    expect(screen.queryByRole("button")).toBeNull();
    screen.getByTestId("no-tabs");
    expect(mockReview).not.toHaveBeenCalled();
  });

  it("never claims there are no drafts while they load", () => {
    mockListDrafts.mockReturnValue({ isLoading: true });
    render(<Page />);

    screen.getByText("Loading drafts…");
    expect(screen.queryByText("No changes waiting for review")).toBeNull();
  });

  it("reports a failed list without claiming there are no drafts", () => {
    mockListDrafts.mockReturnValue({ isError: true });
    render(<Page />);

    screen.getByRole("alert");
    screen.getByRole("heading", { name: "Couldn't load drafts" });
    screen.getByRole("button", { name: "Try again" });
    expect(screen.queryByText("No changes waiting for review")).toBeNull();
  });
});

describe("DraftsPageContent — panes", () => {
  it("shows where the draft came from and why it cannot publish yet", () => {
    givenDrafts([NEWER]);
    render(<Page />);

    screen.getByRole("heading", { name: "Draft" });
    screen.getByText("The API, with an access key");
    screen.getByText("1 value to fill in");
    // The pane counts the cards the centre lists, and the steps behind them.
    screen.getByText("1 change");
    screen.getByText("2 steps");
    expect(
      (screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("opens the inspector only once a change is selected", async () => {
    givenDrafts([OLDER]);
    render(<Page />);
    expect(inspector()).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^Orders/ }));

    expect(inspector()).not.toBeNull();
    screen.getByText("Orders → Orders 2026");
  });

  it("removes a step from the draft after confirmation", async () => {
    givenDrafts([NEWER]);
    render(<Page />);

    await userEvent.click(
      screen.getByRole("button", { name: /^Revenue by region/ }),
    );
    await userEvent.click(
      within(
        screen.getByRole("listitem", { name: "Update filters" }),
      ).getByRole("button", { name: "Remove" }),
    );
    screen.getByText("Remove this change from the draft?");
    await userEvent.click(
      screen.getByRole("button", { name: "Remove change" }),
    );

    expect(mockRevise).toHaveBeenCalledWith({
      draftId: NEWER.draftId,
      expectedLogSignature: "sig-newer",
      ops: [{ type: "removeCommand", commandIndex: 1 }],
    });
  });
});

describe("DraftsPageContent — centre and lifecycle", () => {
  it("fills in a late-bound value under the change that needs it", async () => {
    givenDrafts([NEWER]);
    render(<Page />);
    screen.getByText("1 value still needs to be filled in before publishing.");

    await userEvent.type(
      screen.getByRole("textbox", { name: /Value.*Region/ }),
      "EMEA",
    );
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(mockRevise).toHaveBeenCalledWith({
      draftId: NEWER.draftId,
      expectedLogSignature: "sig-newer",
      ops: [
        {
          type: "bindOperand",
          commandIndex: 1,
          jsonPath: "$.filters[0].value",
          value: "EMEA",
        },
      ],
    });
  });

  it("shows a rejected revision instead of reporting it applied", async () => {
    givenDrafts([NEWER]);
    mockRevise.mockRejectedValue(new Error("changed since review"));
    render(<Page />);

    const input = screen.getByRole("textbox", { name: /Value.*Region/ });
    await userEvent.type(input, "EMEA");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await screen.findByText(/This draft changed while you were reviewing it/);
    expect((input as HTMLInputElement).value).toBe("EMEA");
  });

  it("publishes a ready draft and moves on to the drafts still waiting", async () => {
    givenDrafts([OLDER, NEWER]);
    mockClientQuery.mockResolvedValue([NEWER]);
    render(<Page initialDraftId={OLDER.draftId} />);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(mockPublish).toHaveBeenCalledWith({
      draftId: OLDER.draftId,
      expectedCommandCount: "1",
      expectedLogSignature: "sig-older",
    });
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/drafts",
        replace: true,
      }),
    );
  });

  it("goes home after publishing the last draft", async () => {
    givenDrafts([OLDER]);
    render(<Page />);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenLastCalledWith({ to: "/", replace: true }),
    );
  });

  it("discards the open draft only after confirmation", async () => {
    const user = userEvent.setup();
    givenDrafts([NEWER]);
    render(<Page />);

    await user.click(
      screen.getByRole("button", { name: "More draft actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Discard draft/ }),
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "Discard all 2 changes?",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockDiscard).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "More draft actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Discard draft/ }),
    );
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Discard draft" }));
    });

    await waitFor(() =>
      expect(mockDiscard).toHaveBeenCalledWith({ draftId: NEWER.draftId }),
    );
  });
});

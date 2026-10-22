import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import type { UUID } from "@dashframe/types";

const { requestHost, openUrl } = vi.hoisted(() => ({
  requestHost: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("@/data/host", async (importOriginal) => ({
  HostOperationError: (await importOriginal<typeof import("@/data/host")>())
    .HostOperationError,
  requestHost,
}));
vi.mock("@/lib/oauth-authorization-target", () => ({
  openOAuthAuthorizationUrl: openUrl,
}));

import { Ga4SignInAgain } from "./Ga4SignInAgain";

const SOURCE_ID = "7c8d7e90-3803-4885-8349-faae10bb829d" as UUID;

/** The server's view of the sign-in once Google redirects back. */
function serverFinishesWith(finished: Record<string, unknown>) {
  requestHost.mockImplementation(async (operation: string) => {
    if (operation === "startConnectorSetup")
      return { sessionId: "session-1", authorizeUrl: "https://google/auth" };
    if (operation === "getConnectorSetupSession") return finished;
    throw new Error(`unexpected ${operation}`);
  });
}

async function clickSignIn() {
  fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
  // One poll interval, then let the poll's promises settle.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
}

describe("Ga4SignInAgain", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    openUrl.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renews the sign-in of this source and reports back", async () => {
    serverFinishesWith({ state: "connected", dataSourceId: SOURCE_ID });
    const onSignedIn = vi.fn();
    render(<Ga4SignInAgain sourceId={SOURCE_ID} onSignedIn={onSignedIn} />);

    await clickSignIn();

    expect(requestHost).toHaveBeenCalledWith("startConnectorSetup", {
      connectorId: "googleAnalytics",
      requestedName: "Google Analytics",
      reconnectDataSourceId: SOURCE_ID,
    });
    expect(openUrl).toHaveBeenCalledWith("https://google/auth");
    expect(onSignedIn).toHaveBeenCalledOnce();
  });

  it("shows why a sign-in was refused and lets the user try again", async () => {
    serverFinishesWith({
      state: "failed",
      failureMessage:
        "This Google account can't access the properties this source uses.",
    });
    const onSignedIn = vi.fn();
    render(<Ga4SignInAgain sourceId={SOURCE_ID} onSignedIn={onSignedIn} />);

    await clickSignIn();

    screen.getByText(
      "This Google account can't access the properties this source uses.",
    );
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).not.toHaveProperty("disabled", true);
  });
});

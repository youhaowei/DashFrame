import { describe, expect, it, vi } from "vite-plus/test";

import { reloadRootWithFreshWorkspaceState } from "./clear-all-data-navigation";

function navigationWindow(href: string) {
  const assign = vi.fn();
  const reload = vi.fn();
  const replaceState = vi.fn();
  return {
    assign,
    reload,
    replaceState,
    target: {
      history: { replaceState, state: { keep: "value" } },
      location: { assign, href, reload },
    } as unknown as Pick<Window, "history" | "location">,
  };
}

describe("reloadRootWithFreshWorkspaceState", () => {
  it("reloads the packaged document after replacing only its route hash", () => {
    const fixture = navigationWindow(
      "file:///Applications/DashFrame.app/Contents/Resources/index.html?runtime=loopback#/dashboards/report-1",
    );

    reloadRootWithFreshWorkspaceState(fixture.target);

    expect(fixture.replaceState).toHaveBeenCalledWith(
      { keep: "value" },
      "",
      "file:///Applications/DashFrame.app/Contents/Resources/index.html?runtime=loopback#/",
    );
    expect(fixture.reload).toHaveBeenCalledOnce();
    expect(fixture.assign).not.toHaveBeenCalled();
  });

  it("loads the browser root as a new document", () => {
    const fixture = navigationWindow(
      "http://127.0.0.1:31381/dashboards/report-1?stale=true#section",
    );

    reloadRootWithFreshWorkspaceState(fixture.target);

    expect(fixture.assign).toHaveBeenCalledWith("http://127.0.0.1:31381/");
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(fixture.replaceState).not.toHaveBeenCalled();
  });
});

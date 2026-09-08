type NavigationWindow = Pick<Window, "history" | "location">;

/** Reload the root so post-clear routing cannot reuse this client's cache. */
export function reloadRootWithFreshWorkspaceState(
  target: NavigationWindow = window,
): void {
  const root = new URL(target.location.href);
  if (root.protocol === "file:") {
    root.hash = "/";
    target.history.replaceState(target.history.state, "", root.href);
    target.location.reload();
    return;
  } else {
    root.pathname = "/";
    root.search = "";
    root.hash = "";
  }
  target.location.assign(root.href);
}

interface DesktopProjectBridge {
  project?: {
    revealFolder?: () => Promise<void>;
  };
}

/**
 * Opens the project's folder in the system file manager, when the host shell
 * can: the desktop app's main process reveals it, and never hands the renderer
 * the path itself. Undefined where no such bridge exists (the browser app).
 */
export function projectFolderRevealer(): (() => Promise<void>) | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = (
    window as typeof window & { dashframe?: DesktopProjectBridge }
  ).dashframe;
  const reveal = bridge?.project?.revealFolder;
  return reveal ? () => reveal() : undefined;
}

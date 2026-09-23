import { useShellStore } from "@/lib/stores/shell-store";
import { Button, cn } from "@wystack/ui-react";
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "@wystack/ui-react/icons";
import { useCallback, type ComponentProps, type ReactNode } from "react";

export interface WorkbenchPanes {
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
}

/**
 * Whether a workbench's panes are open, remembered per viewer for each kind of
 * artifact: collapsing the inspector on one insight collapses it on every
 * insight, and leaves data sources alone. `artifactType` is any stable name
 * the page picks ("insight", "data-source", "draft").
 */
export function useWorkbenchPanes(artifactType: string): WorkbenchPanes {
  const leftOpen = useShellStore(
    (s) => s.workbenchPanes[artifactType]?.left ?? true,
  );
  const rightOpen = useShellStore(
    (s) => s.workbenchPanes[artifactType]?.right ?? true,
  );
  const setPaneOpen = useShellStore((s) => s.setWorkbenchPaneOpen);

  const setLeftOpen = useCallback(
    (open: boolean) => setPaneOpen(artifactType, "left", open),
    [setPaneOpen, artifactType],
  );
  const setRightOpen = useCallback(
    (open: boolean) => setPaneOpen(artifactType, "right", open),
    [setPaneOpen, artifactType],
  );

  return {
    leftOpen,
    rightOpen,
    setLeftOpen,
    setRightOpen,
    toggleLeft: useCallback(
      () => setLeftOpen(!leftOpen),
      [setLeftOpen, leftOpen],
    ),
    toggleRight: useCallback(
      () => setRightOpen(!rightOpen),
      [setRightOpen, rightOpen],
    ),
  };
}

export interface WorkbenchProps extends Omit<
  ComponentProps<"div">,
  "children"
> {
  /** The artifact's own configuration. */
  left?: ReactNode;
  leftOpen?: boolean;
  /** Inspector for the selected part of the artifact. */
  right?: ReactNode;
  /**
   * Whether the inspector shows. A page with nothing selected to inspect
   * passes `false` whatever the remembered state is.
   */
  rightOpen?: boolean;
  /** The artifact itself: canvas, preview grid, draft under review. */
  children: ReactNode;
}

const PANE =
  // Shrinkable, so on a narrow window the panes give way before the centre
  // does: its header holds the only controls that collapse them.
  "h-full min-w-0 overflow-hidden transition-[width] duration-200 motion-reduce:transition-none";

/**
 * The shared artifact workbench: configuration on the left, the artifact in
 * the centre, an inspector on the right. A collapsed pane animates to zero
 * width and leaves the tab order and the accessibility tree, so its controls
 * cannot be reached while hidden.
 */
export function Workbench({
  left,
  leftOpen = true,
  right,
  rightOpen = true,
  children,
  className,
  ...props
}: WorkbenchProps) {
  return (
    <div
      {...props}
      className={cn("flex h-full min-w-0 overflow-hidden", className)}
    >
      {left !== undefined && (
        <aside
          inert={!leftOpen}
          aria-hidden={!leftOpen}
          className={cn(PANE, leftOpen ? "w-64" : "w-0")}
        >
          <div className="h-full w-64">{left}</div>
        </aside>
      )}

      <section className="flex min-w-[min(18rem,100%)] flex-1 flex-col gap-2 overflow-hidden px-1.5 py-2">
        {children}
      </section>

      {right !== undefined && (
        <aside
          inert={!rightOpen}
          aria-hidden={!rightOpen}
          className={cn(PANE, rightOpen ? "w-60" : "w-0")}
        >
          <div className="h-full w-60 min-w-0">{right}</div>
        </aside>
      )}
    </div>
  );
}

const PANE_TOGGLE_ICONS = {
  left: { open: PanelLeftOpenIcon, close: PanelLeftCloseIcon },
  right: { open: PanelRightOpenIcon, close: PanelRightCloseIcon },
} as const;

/** The icon button that collapses or expands one workbench pane. */
export function WorkbenchPaneToggle({
  side,
  open,
  paneName,
  onToggle,
}: {
  side: "left" | "right";
  open: boolean;
  /** Names the pane in the button's label: "Collapse {paneName} pane". */
  paneName: string;
  onToggle: () => void;
}) {
  const icon = PANE_TOGGLE_ICONS[side][open ? "close" : "open"];
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={icon}
      iconOnly
      label={open ? `Collapse ${paneName} pane` : `Expand ${paneName} pane`}
      onClick={onToggle}
    />
  );
}

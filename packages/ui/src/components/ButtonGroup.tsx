import { ButtonGroup as PrimitiveButtonGroup } from "../primitives/button-group";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../primitives/dropdown-menu";
import { Button, type ItemAction } from "./button";
import { cn } from "../lib/utils";

export type { ItemAction };

export interface ButtonGroupProps {
  actions: ItemAction[];
  className?: string;
  /**
   * Icon-only mode applied to all top-level buttons
   */
  iconOnly?: boolean;
}

/**
 * Group consecutive actions with the same group identifier.
 * Single actions are returned as-is, while grouped actions are returned as arrays.
 */
function groupActions(actions: ItemAction[]): (ItemAction | ItemAction[])[] {
  const result: (ItemAction | ItemAction[])[] = [];
  let currentGroup: ItemAction[] = [];
  let currentGroupId: string | undefined;

  for (const action of actions) {
    if (action.group && action.group === currentGroupId) {
      currentGroup.push(action);
    } else {
      if (currentGroup.length > 0) {
        result.push(
          currentGroup.length === 1 ? currentGroup[0]! : currentGroup,
        );
      }
      currentGroup = [action];
      currentGroupId = action.group;
    }
  }

  if (currentGroup.length > 0) {
    result.push(currentGroup.length === 1 ? currentGroup[0]! : currentGroup);
  }

  return result;
}

/**
 * Render a dropdown menu action with nested items.
 */
function DropdownAction({
  action,
  iconOnly,
}: {
  action: ItemAction;
  iconOnly: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          label={action.label}
          icon={action.icon}
          variant={action.variant}
          size={action.size}
          iconOnly={action.iconOnly ?? iconOnly}
          className={action.className}
          tooltip={action.tooltip}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {action.actions?.map((nestedAction, nestedIndex) => (
          <DropdownMenuItem key={nestedIndex} onClick={nestedAction.onClick}>
            {nestedAction.icon && <nestedAction.icon aria-hidden />}
            {nestedAction.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * ButtonGroup - Renders a group of action buttons with grouping and dropdown support
 *
 * Standard component for rendering groups of action buttons in DashFrame.
 * Supports visual grouping (via `group` property) and nested dropdowns (via `actions` property).
 *
 * Features:
 * - Visual button grouping (buttons with same `group` value are connected)
 * - Nested dropdowns (actions with `actions` array become dropdown menus)
 * - Icon-only mode for compact toolbars
 * - Automatic gap spacing between groups
 *
 * @example
 * ```tsx
 * <ButtonGroup
 *   actions={[
 *     { label: 'Save', onClick: handleSave, icon: Save, group: 'edit' },
 *     { label: 'Undo', onClick: handleUndo, icon: Undo, group: 'edit' },
 *     { label: 'Delete', onClick: handleDelete, icon: Trash, variant: 'destructive' },
 *     {
 *       label: 'More',
 *       icon: MoreHorizontal,
 *       actions: [
 *         { label: 'Archive', onClick: handleArchive, icon: Archive },
 *         { label: 'Report', onClick: handleReport, icon: Flag }
 *       ]
 *     }
 *   ]}
 * />
 * ```
 */
export function ButtonGroup({
  actions,
  className,
  iconOnly = false,
}: ButtonGroupProps) {
  if (actions.length === 0) return null;

  const groupedActions = groupActions(actions);

  return (
    <div
      className={cn("flex shrink-0 flex-wrap items-center gap-2", className)}
    >
      {groupedActions.map((item, index) => {
        // Single action (not grouped)
        if (!Array.isArray(item)) {
          // Dropdown action (has nested actions)
          if (item.actions && item.actions.length > 0) {
            return (
              <DropdownAction key={index} action={item} iconOnly={iconOnly} />
            );
          }

          // Regular single action
          return (
            <Button
              key={index}
              label={item.label}
              onClick={item.onClick}
              variant={item.variant}
              icon={item.icon}
              size={item.size}
              iconOnly={item.iconOnly ?? iconOnly}
              className={item.className}
              tooltip={item.tooltip}
              asChild={item.asChild}
              disabled={item.disabled}
            >
              {item.children}
            </Button>
          );
        }

        // Group of actions (ButtonGroup)
        return (
          <PrimitiveButtonGroup key={index}>
            {item.map((groupedAction, groupedIndex) => (
              <Button
                key={groupedIndex}
                label={groupedAction.label}
                onClick={groupedAction.onClick}
                variant={groupedAction.variant}
                icon={groupedAction.icon}
                size={groupedAction.size}
                iconOnly={groupedAction.iconOnly ?? iconOnly}
                className={groupedAction.className}
                tooltip={groupedAction.tooltip}
                asChild={groupedAction.asChild}
                disabled={groupedAction.disabled}
              >
                {groupedAction.children}
              </Button>
            ))}
          </PrimitiveButtonGroup>
        );
      })}
    </div>
  );
}

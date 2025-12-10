import type { Meta, StoryObj } from "@storybook/react";
import { ActionGroup } from "./ActionGroup";
import { Plus, Delete, Refresh, Database, Edit, X } from "../lib/icons";

const meta = {
  title: "Components/Actions/ActionGroup",
  component: ActionGroup,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    compact: {
      control: "boolean",
      description: "Compact mode shows only icons without labels",
    },
  },
} satisfies Meta<typeof ActionGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default action group with labels and icons (expanded mode)
 */
export const Default: Story = {
  args: {
    actions: [
      { label: "Save", onClick: () => alert("Save clicked"), icon: Database },
      {
        label: "Cancel",
        onClick: () => alert("Cancel clicked"),
        variant: "outline",
      },
    ],
  },
};

/**
 * Compact mode with icons only
 */
export const Compact: Story = {
  args: {
    compact: true,
    actions: [
      {
        label: "Create",
        onClick: () => alert("Create"),
        icon: Plus,
        tooltip: "Create new item",
      },
      {
        label: "Refresh",
        onClick: () => alert("Refresh"),
        icon: Refresh,
        tooltip: "Refresh data",
      },
      {
        label: "Delete",
        onClick: () => alert("Delete"),
        icon: Delete,
        variant: "destructive",
        tooltip: "Delete item",
      },
    ],
  },
};

/**
 * DashFrame action patterns - Create/Delete
 */
export const CreateDelete: Story = {
  args: {
    actions: [
      {
        label: "Create Data Source",
        onClick: () => alert("Create"),
        icon: Plus,
        variant: "default",
      },
      {
        label: "Delete",
        onClick: () => alert("Delete"),
        icon: Delete,
        variant: "destructive",
      },
    ],
  },
};

/**
 * DashFrame action patterns - Save/Cancel
 */
export const SaveCancel: Story = {
  args: {
    actions: [
      {
        label: "Save Changes",
        onClick: () => alert("Save"),
        icon: Database,
        variant: "default",
      },
      {
        label: "Cancel",
        onClick: () => alert("Cancel"),
        icon: X,
        variant: "outline",
      },
    ],
  },
};

/**
 * DashFrame action patterns - Refresh/Settings (compact)
 */
export const RefreshSettings: Story = {
  args: {
    compact: true,
    actions: [
      {
        label: "Refresh",
        onClick: () => alert("Refresh"),
        icon: Refresh,
        tooltip: "Refresh data sources",
      },
      {
        label: "Settings",
        onClick: () => alert("Settings"),
        icon: Database,
        variant: "outline",
        tooltip: "Data source settings",
      },
    ],
  },
};

/**
 * Mixed variants with different button styles
 */
export const MixedVariants: Story = {
  args: {
    actions: [
      { label: "Primary", onClick: () => {}, variant: "default" },
      { label: "Secondary", onClick: () => {}, variant: "secondary" },
      { label: "Outline", onClick: () => {}, variant: "outline" },
      {
        label: "Destructive",
        onClick: () => {},
        variant: "destructive",
        icon: Delete,
      },
    ],
  },
};

/**
 * Compact mode with tooltips for better UX
 */
export const CompactWithTooltips: Story = {
  args: {
    compact: true,
    actions: [
      {
        label: "Add Data Source",
        onClick: () => {},
        icon: Database,
        tooltip: "Add a new data source",
      },
      {
        label: "Edit Settings",
        onClick: () => {},
        icon: Edit,
        variant: "outline",
        tooltip: "Edit data source settings",
      },
      {
        label: "Refresh All",
        onClick: () => {},
        icon: Refresh,
        variant: "outline",
        tooltip: "Refresh all data sources",
      },
      {
        label: "Delete Selected",
        onClick: () => {},
        icon: Delete,
        variant: "destructive",
        tooltip: "Delete selected data source",
      },
    ],
  },
};

/**
 * Actions with labels only (no icons)
 */
export const LabelsOnly: Story = {
  args: {
    actions: [
      { label: "Previous", onClick: () => {}, variant: "outline" },
      { label: "Next", onClick: () => {} },
    ],
  },
};

/**
 * Single action (edge case)
 */
export const SingleAction: Story = {
  args: {
    actions: [
      {
        label: "Create Visualization",
        onClick: () => alert("Create"),
        icon: Plus,
      },
    ],
  },
};

/**
 * Empty actions (should render nothing)
 */
export const EmptyActions: Story = {
  args: {
    actions: [],
  },
};

/**
 * Compact mode with mixed icon presence
 */
export const CompactMixedIcons: Story = {
  args: {
    compact: true,
    actions: [
      {
        label: "With Icon",
        onClick: () => {},
        icon: Plus,
        tooltip: "Has icon",
      },
      {
        label: "No Icon",
        onClick: () => {},
        tooltip: "No icon - will show label",
      },
      {
        label: "Another Icon",
        onClick: () => {},
        icon: Refresh,
        tooltip: "Has icon",
      },
    ],
  },
  decorators: [
    (Story) => (
      <div className="space-y-4">
        <Story />
        <p className="text-muted-foreground max-w-md text-xs">
          Note: In compact mode, buttons without icons will show labels instead
        </p>
      </div>
    ),
  ],
};

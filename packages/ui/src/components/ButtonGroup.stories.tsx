import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ButtonGroup } from "./ButtonGroup";
import {
  PlusIcon,
  DeleteIcon,
  RefreshIcon,
  DatabaseIcon,
  EditIcon,
  CloseIcon,
} from "../lib/icons";

const meta = {
  title: "Components/Actions/ButtonGroup",
  component: ButtonGroup,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    iconOnly: {
      control: "boolean",
      description: "Compact mode shows only icons without labels",
    },
  },
} satisfies Meta<typeof ButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default action group with labels and icons (expanded mode)
 */
export const Default: Story = {
  args: {
    actions: [
      {
        label: "Save",
        onClick: () => alert("Save clicked"),
        icon: DatabaseIcon,
      },
      {
        label: "Cancel",
        onClick: () => alert("Cancel clicked"),
        variant: "outlined",
      },
    ],
  },
};

/**
 * Compact mode with icons only
 */
export const Compact: Story = {
  args: {
    iconOnly: true,
    actions: [
      {
        label: "Create",
        onClick: () => alert("Create"),
        icon: PlusIcon,
        tooltip: "Create new item",
      },
      {
        label: "Refresh",
        onClick: () => alert("Refresh"),
        icon: RefreshIcon,
        tooltip: "Refresh data",
      },
      {
        label: "Delete",
        onClick: () => alert("Delete"),
        icon: DeleteIcon,
        color: "danger",
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
        icon: PlusIcon,
      },
      {
        label: "Delete",
        onClick: () => alert("Delete"),
        icon: DeleteIcon,
        color: "danger",
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
        icon: DatabaseIcon,
      },
      {
        label: "Cancel",
        onClick: () => alert("Cancel"),
        icon: CloseIcon,
        variant: "outlined",
      },
    ],
  },
};

/**
 * DashFrame action patterns - Refresh/Settings (compact)
 */
export const RefreshSettings: Story = {
  args: {
    iconOnly: true,
    actions: [
      {
        label: "Refresh",
        onClick: () => alert("Refresh"),
        icon: RefreshIcon,
        tooltip: "Refresh data sources",
      },
      {
        label: "Settings",
        onClick: () => alert("Settings"),
        icon: DatabaseIcon,
        variant: "outlined",
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
      { label: "Primary", onClick: () => {} },
      { label: "Secondary", onClick: () => {}, color: "secondary" },
      { label: "Outlined", onClick: () => {}, variant: "outlined" },
      {
        label: "Danger",
        onClick: () => {},
        color: "danger",
        icon: DeleteIcon,
      },
    ],
  },
};

/**
 * Compact mode with tooltips for better UX
 */
export const CompactWithTooltips: Story = {
  args: {
    iconOnly: true,
    actions: [
      {
        label: "Add Data Source",
        onClick: () => {},
        icon: DatabaseIcon,
        tooltip: "Add a new data source",
      },
      {
        label: "Edit Settings",
        onClick: () => {},
        icon: EditIcon,
        variant: "outlined",
        tooltip: "Edit data source settings",
      },
      {
        label: "Refresh All",
        onClick: () => {},
        icon: RefreshIcon,
        variant: "outlined",
        tooltip: "Refresh all data sources",
      },
      {
        label: "Delete Selected",
        onClick: () => {},
        icon: DeleteIcon,
        color: "danger",
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
      { label: "Previous", onClick: () => {}, variant: "outlined" },
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
        icon: PlusIcon,
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
    iconOnly: true,
    actions: [
      {
        label: "With Icon",
        onClick: () => {},
        icon: PlusIcon,
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
        icon: RefreshIcon,
        tooltip: "Has icon",
      },
    ],
  },
  decorators: [
    (Story) => (
      <div className="space-y-4">
        <Story />
        <p className="max-w-md text-xs text-muted-foreground">
          Note: In compact mode, buttons without icons will show labels instead
        </p>
      </div>
    ),
  ],
};

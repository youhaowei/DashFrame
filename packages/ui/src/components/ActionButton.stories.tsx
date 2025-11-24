import type { Meta, StoryObj } from "@storybook/react";
import { ActionButton } from "./ActionButton";
import { Plus, Trash2, Refresh, Database, Edit3, X, ArrowRight } from "../lib/icons";

const meta = {
  title: "Components/Actions/ActionButton",
  component: ActionButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    compact: {
      control: "boolean",
      description: "Compact mode shows only icon (if available) or label",
    },
    variant: {
      control: "select",
      options: ["default", "outline", "destructive", "secondary", "ghost", "link"],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
  },
} satisfies Meta<typeof ActionButton>;

export default meta;
type Story = Omit<StoryObj<typeof meta>, "args"> & {
  args?: StoryObj<typeof meta>["args"];
};

/**
 * Standard button with icon and label
 */
export const Default: Story = {
  args: {
    label: "Save",
    onClick: () => alert("Save clicked"),
    icon: Database,
    variant: "default",
  },
};

/**
 * Compact mode - icon only (when icon is provided)
 */
export const Compact: Story = {
  args: {
    label: "Delete",
    onClick: () => alert("Delete clicked"),
    icon: Trash2,
    variant: "destructive",
    compact: true,
    tooltip: "Delete item",
  },
};

/**
 * Button variants
 */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <ActionButton label="Default" onClick={() => {}} variant="default" />
        <ActionButton label="Outline" onClick={() => {}} variant="outline" />
        <ActionButton label="Secondary" onClick={() => {}} variant="secondary" />
        <ActionButton label="Ghost" onClick={() => {}} variant="ghost" />
        <ActionButton label="Link" onClick={() => {}} variant="link" />
      </div>
      <div className="flex gap-2">
        <ActionButton
          label="Destructive"
          onClick={() => {}}
          variant="destructive"
          icon={Trash2}
        />
      </div>
    </div>
  ),
};

/**
 * With icons
 */
export const WithIcons: Story = {
  render: () => (
    <div className="flex gap-2">
      <ActionButton
        label="Create"
        onClick={() => {}}
        icon={Plus}
        variant="default"
      />
      <ActionButton
        label="Edit"
        onClick={() => {}}
        icon={Edit3}
        variant="outline"
      />
      <ActionButton
        label="Refresh"
        onClick={() => {}}
        icon={Refresh}
        variant="ghost"
      />
      <ActionButton
        label="Delete"
        onClick={() => {}}
        icon={Trash2}
        variant="destructive"
      />
    </div>
  ),
};

/**
 * Link button (with href)
 */
export const LinkButton: Story = {
  args: {
    label: "View Details",
    href: "#",
    icon: ArrowRight,
    variant: "outline",
  },
};

/**
 * Compact mode examples
 */
export const CompactMode: Story = {
  render: () => (
    <div className="flex gap-2">
      <ActionButton
        label="Create"
        onClick={() => {}}
        icon={Plus}
        compact
        tooltip="Create new item"
      />
      <ActionButton
        label="Refresh"
        onClick={() => {}}
        icon={Refresh}
        compact
        tooltip="Refresh data"
      />
      <ActionButton
        label="Delete"
        onClick={() => {}}
        icon={Trash2}
        variant="destructive"
        compact
        tooltip="Delete item"
      />
      <ActionButton
        label="No Icon"
        onClick={() => {}}
        compact
        tooltip="Shows label in compact mode when no icon"
      />
    </div>
  ),
};

/**
 * Sizes
 */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <ActionButton label="Small" onClick={() => {}} size="sm" icon={Plus} />
      <ActionButton label="Default" onClick={() => {}} size="default" icon={Plus} />
      <ActionButton label="Large" onClick={() => {}} size="lg" icon={Plus} />
      <ActionButton label="Icon" onClick={() => {}} size="icon" icon={Plus} />
    </div>
  ),
};


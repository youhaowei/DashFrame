import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";
import { Plus, Trash2, Refresh, Database, Edit3 } from "../lib/icons";

const meta = {
  title: "Components/Actions/Button",
  component: Button,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    iconOnly: {
      control: "boolean",
      description:
        "Icon-only mode shows only icon (if available) with sr-only label",
    },
    variant: {
      control: "select",
      options: [
        "default",
        "outline",
        "destructive",
        "secondary",
        "ghost",
        "link",
      ],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg"],
    },
  },
} satisfies Meta<typeof Button>;

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
 * Button variants
 */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button label="Default" onClick={() => {}} variant="default" />
        <Button label="Outline" onClick={() => {}} variant="outline" />
        <Button label="Secondary" onClick={() => {}} variant="secondary" />
        <Button label="Ghost" onClick={() => {}} variant="ghost" />
        <Button label="Link" onClick={() => {}} variant="link" />
      </div>
      <div className="flex gap-2">
        <Button
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
      <Button label="Create" onClick={() => {}} icon={Plus} variant="default" />
      <Button label="Edit" onClick={() => {}} icon={Edit3} variant="outline" />
      <Button
        label="Refresh"
        onClick={() => {}}
        icon={Refresh}
        variant="ghost"
      />
      <Button
        label="Delete"
        onClick={() => {}}
        icon={Trash2}
        variant="destructive"
      />
    </div>
  ),
};

/**
 * Icon-only mode examples
 */
export const IconOnlyMode: Story = {
  render: () => (
    <div className="flex gap-2">
      <Button
        label="Create"
        onClick={() => {}}
        icon={Plus}
        iconOnly
        tooltip="Create new item"
      />
      <Button
        label="Refresh"
        onClick={() => {}}
        icon={Refresh}
        iconOnly
        tooltip="Refresh data"
      />
      <Button
        label="Delete"
        onClick={() => {}}
        icon={Trash2}
        variant="destructive"
        iconOnly
        tooltip="Delete item"
      />
      <Button
        label="No Icon"
        onClick={() => {}}
        iconOnly
        tooltip="Shows label in iconOnly mode when no icon"
      />
    </div>
  ),
};

/**
 * Sizes
 */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {/* Small size group */}
      <div className="flex items-center gap-2">
        <Button label="Small" onClick={() => {}} size="sm" icon={Plus} />
        <Button
          label="Small Compact"
          onClick={() => {}}
          size="sm"
          icon={Plus}
          iconOnly
        />
      </div>

      {/* Default size group */}
      <div className="flex items-center gap-2">
        <Button label="Default" onClick={() => {}} size="default" icon={Plus} />
        <Button
          label="Default Compact"
          onClick={() => {}}
          size="default"
          icon={Plus}
          iconOnly
        />
      </div>

      {/* Large size group */}
      <div className="flex items-center gap-2">
        <Button label="Large" onClick={() => {}} size="lg" icon={Plus} />
        <Button
          label="Large Compact"
          onClick={() => {}}
          size="lg"
          icon={Plus}
          iconOnly
        />
      </div>
    </div>
  ),
};

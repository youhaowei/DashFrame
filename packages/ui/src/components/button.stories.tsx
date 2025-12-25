import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";
import {
  PlusIcon,
  DeleteIcon,
  RefreshIcon,
  DatabaseIcon,
  EditIcon,
} from "../lib/icons";

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
      options: ["filled", "outlined", "text", "link"],
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
    icon: DatabaseIcon,
  },
};

/**
 * Button variants
 */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button label="Filled" onClick={() => {}} variant="filled" />
        <Button label="Outlined" onClick={() => {}} variant="outlined" />
        <Button label="Secondary" onClick={() => {}} color="secondary" />
        <Button label="Text" onClick={() => {}} variant="text" />
        <Button label="Link" onClick={() => {}} variant="link" />
      </div>
      <div className="flex gap-2">
        <Button
          label="Danger"
          onClick={() => {}}
          color="danger"
          icon={DeleteIcon}
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
      <Button label="Create" onClick={() => {}} icon={PlusIcon} />
      <Button
        label="Edit"
        onClick={() => {}}
        icon={EditIcon}
        variant="outlined"
      />
      <Button
        label="Refresh"
        onClick={() => {}}
        icon={RefreshIcon}
        variant="text"
      />
      <Button
        label="Delete"
        onClick={() => {}}
        icon={DeleteIcon}
        color="danger"
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
        icon={PlusIcon}
        iconOnly
        tooltip="Create new item"
      />
      <Button
        label="Refresh"
        onClick={() => {}}
        icon={RefreshIcon}
        iconOnly
        tooltip="Refresh data"
      />
      <Button
        label="Delete"
        onClick={() => {}}
        icon={Trash2}
        color="danger"
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
          icon={PlusIcon}
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
          icon={PlusIcon}
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
          icon={PlusIcon}
          iconOnly
        />
      </div>
    </div>
  ),
};

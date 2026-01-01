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
      options: ["sm", "md", "lg"],
    },
    loading: {
      control: "boolean",
      description: "Shows loading spinner and disables button",
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = Omit<StoryObj<typeof meta>, "args"> & {
  args?: Partial<React.ComponentProps<typeof Button>>;
};

export const Default: Story = {
  args: {
    label: "Add Data Source",
    onClick: () => console.log("clicked"),
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
        <Button
          label="Warn"
          onClick={() => {}}
          color="warn"
          variant="outlined"
        />
        <Button label="Success" onClick={() => {}} color="success" />
      </div>
    </div>
  ),
};

/**
 * Loading states
 */
export const Loading: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button label="Loading" loading />
        <Button label="Saving..." icon={DatabaseIcon} loading />
        <Button label="Outlined" variant="outlined" loading />
        <Button label="Text" variant="text" loading />
      </div>
      <div className="flex items-center gap-2">
        <Button label="Danger" color="danger" loading />
        <Button
          label="Delete"
          color="danger"
          variant="outlined"
          icon={DeleteIcon}
          loading
        />
      </div>
      <div className="flex items-center gap-2">
        <Button label="Refresh" icon={RefreshIcon} iconOnly loading />
        <Button label="Refresh" icon={RefreshIcon} iconOnly size="sm" loading />
        <Button label="Refresh" icon={RefreshIcon} iconOnly size="lg" loading />
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
        label="Add"
        onClick={() => {}}
        icon={PlusIcon}
        variant="filled"
        iconOnly
      />
      <Button
        label="Edit"
        onClick={() => {}}
        icon={EditIcon}
        variant="outlined"
        iconOnly
      />
      <Button
        label="Delete"
        onClick={() => {}}
        icon={DeleteIcon}
        color="danger"
        iconOnly
      />
      <Button
        label="Refresh"
        onClick={() => {}}
        icon={RefreshIcon}
        variant="text"
        iconOnly
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
        <Button label="Small" onClick={() => {}} size="sm" icon={PlusIcon} />
        <Button
          label="Small Compact"
          onClick={() => {}}
          size="sm"
          icon={PlusIcon}
          iconOnly
        />
      </div>

      {/* Medium size group (default) */}
      <div className="flex items-center gap-2">
        <Button label="Medium" onClick={() => {}} size="md" icon={PlusIcon} />
        <Button
          label="Medium Compact"
          onClick={() => {}}
          size="md"
          icon={PlusIcon}
          iconOnly
        />
      </div>

      {/* Large size group */}
      <div className="flex items-center gap-2">
        <Button label="Large" onClick={() => {}} size="lg" icon={PlusIcon} />
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

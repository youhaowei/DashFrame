import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { Checkbox } from "./checkbox";
import { Label } from "./label";

const meta = {
  title: "Primitives/Forms/Checkbox",
  component: Checkbox,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    checked: {
      control: "boolean",
    },
    disabled: {
      control: "boolean",
    },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const Checked: Story = {
  args: {
    checked: true,
  },
};

export const Indeterminate: Story = {
  args: {
    checked: "indeterminate",
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const DisabledChecked: Story = {
  args: {
    checked: true,
    disabled: true,
  },
};

export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="terms" />
      <Label htmlFor="terms">Accept terms and conditions</Label>
    </div>
  ),
};

export const FormExample: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Checkbox id="newsletter" defaultChecked />
        <Label htmlFor="newsletter">Subscribe to newsletter</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="marketing" />
        <Label htmlFor="marketing">Receive marketing emails</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="updates" />
        <Label htmlFor="updates">Get product updates</Label>
      </div>
    </div>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Checkbox id="analytics" className="mt-1" />
        <div className="grid gap-1.5">
          <Label htmlFor="analytics">Enable analytics</Label>
          <p className="text-muted-foreground text-sm">
            Help us improve by sending anonymous usage data
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="cookies" className="mt-1" defaultChecked />
        <div className="grid gap-1.5">
          <Label htmlFor="cookies">Allow cookies</Label>
          <p className="text-muted-foreground text-sm">
            Required for the website to function properly
          </p>
        </div>
      </div>
    </div>
  ),
};

export const MultipleStates: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Checkbox id="unchecked" />
        <Label htmlFor="unchecked">Unchecked</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="checked" checked />
        <Label htmlFor="checked">Checked</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="indeterminate" checked="indeterminate" />
        <Label htmlFor="indeterminate">Indeterminate</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="disabled" disabled />
        <Label htmlFor="disabled">Disabled (Unchecked)</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="disabled-checked" checked disabled />
        <Label htmlFor="disabled-checked">Disabled (Checked)</Label>
      </div>
    </div>
  ),
};

export const TaskList: Story = {
  render: () => (
    <div className="space-y-3">
      <div className="mb-4 font-semibold">Today's tasks</div>
      <div className="flex items-center gap-2">
        <Checkbox id="task1" defaultChecked />
        <Label htmlFor="task1" className="line-through opacity-50">
          Review pull requests
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="task2" defaultChecked />
        <Label htmlFor="task2" className="line-through opacity-50">
          Update documentation
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="task3" />
        <Label htmlFor="task3">Write unit tests</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="task4" />
        <Label htmlFor="task4">Fix reported bugs</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="task5" />
        <Label htmlFor="task5">Deploy to production</Label>
      </div>
    </div>
  ),
};

export const NestedCheckboxes: Story = {
  render: () => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox id="parent" checked="indeterminate" />
        <Label htmlFor="parent" className="font-semibold">
          Select all features
        </Label>
      </div>
      <div className="ml-6 space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox id="feature1" defaultChecked />
          <Label htmlFor="feature1">Dark mode</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="feature2" defaultChecked />
          <Label htmlFor="feature2">Auto-save</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="feature3" />
          <Label htmlFor="feature3">Notifications</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="feature4" />
          <Label htmlFor="feature4">Keyboard shortcuts</Label>
        </div>
      </div>
    </div>
  ),
};

/**
 * Interactive test: Verifies checkbox can be toggled by clicking
 */
export const InteractiveToggle: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="interactive-checkbox" aria-label="Toggle me" />
      <Label htmlFor="interactive-checkbox">Click to toggle</Label>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Find the checkbox by its role
    const checkbox = canvas.getByRole("checkbox", { name: /toggle me/i });

    // Initially should be unchecked
    await expect(checkbox).not.toBeChecked();

    // Click to check
    await userEvent.click(checkbox);
    await expect(checkbox).toBeChecked();

    // Click again to uncheck
    await userEvent.click(checkbox);
    await expect(checkbox).not.toBeChecked();

    // Test keyboard interaction (Space to toggle)
    checkbox.focus();
    await userEvent.keyboard(" ");
    await expect(checkbox).toBeChecked();
  },
};

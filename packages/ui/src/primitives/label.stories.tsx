import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Input } from "./input";
import { Label } from "./label";

const meta = {
  title: "Primitives/Forms/Label",
  component: Label,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    htmlFor: {
      control: "text",
    },
  },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Email address",
  },
};

export const WithInput: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Label htmlFor="email">Email address</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
};

export const WithRequiredIndicator: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Label htmlFor="required-field">
        Required field
        <span className="text-destructive">*</span>
      </Label>
      <Input id="required-field" type="text" placeholder="Enter value..." />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="group" data-disabled="true">
      <Label htmlFor="disabled-input">Disabled field</Label>
      <Input id="disabled-input" disabled placeholder="Cannot edit" />
    </div>
  ),
};

export const MultipleFields: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="username">Username</Label>
        <Input id="username" type="text" placeholder="johndoe" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email-multi">Email</Label>
        <Input id="email-multi" type="email" placeholder="john@example.com" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" placeholder="••••••••" />
      </div>
    </div>
  ),
};

import type { Meta, StoryObj } from "@storybook/react";
import { Separator } from "./separator";

const meta = {
  title: "Primitives/Layout/Separator",
  component: Separator,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    orientation: {
      control: "select",
      options: ["horizontal", "vertical"],
    },
    decorative: {
      control: "boolean",
    },
  },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <div className="w-80">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Section 1</h3>
          <p className="text-muted-foreground text-sm">
            Content for the first section.
          </p>
        </div>
        <Separator />
        <div>
          <h3 className="text-sm font-medium">Section 2</h3>
          <p className="text-muted-foreground text-sm">
            Content for the second section.
          </p>
        </div>
      </div>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="flex h-20 items-center">
      <div className="px-4">
        <span className="text-sm">Item 1</span>
      </div>
      <Separator orientation="vertical" />
      <div className="px-4">
        <span className="text-sm">Item 2</span>
      </div>
      <Separator orientation="vertical" />
      <div className="px-4">
        <span className="text-sm">Item 3</span>
      </div>
    </div>
  ),
};

export const InCard: Story = {
  render: () => (
    <div className="bg-card w-96 rounded-xl border p-6">
      <div>
        <h3 className="text-lg font-semibold">Dashboard Settings</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your dashboard preferences
        </p>
      </div>
      <Separator className="my-4" />
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm">Auto-refresh</span>
          <span className="text-muted-foreground text-sm">Every 5 minutes</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm">Theme</span>
          <span className="text-muted-foreground text-sm">System</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm">Language</span>
          <span className="text-muted-foreground text-sm">English</span>
        </div>
      </div>
    </div>
  ),
};

export const WithDecorativeText: Story = {
  render: () => (
    <div className="w-96">
      <div className="space-y-4">
        <p className="text-sm">Content before the separator</p>
        <div className="relative">
          <Separator />
          <span className="bg-background text-muted-foreground absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-2 text-xs">
            OR
          </span>
        </div>
        <p className="text-sm">Content after the separator</p>
      </div>
    </div>
  ),
};

export const NavigationMenu: Story = {
  render: () => (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-6 px-4 py-3">
        <span className="text-sm font-semibold">DashFrame</span>
        <Separator orientation="vertical" className="h-6" />
        <nav className="flex items-center gap-4">
          <a
            href="#"
            className="hover:text-foreground text-muted-foreground text-sm"
          >
            Dashboard
          </a>
          <a
            href="#"
            className="hover:text-foreground text-muted-foreground text-sm"
          >
            Insights
          </a>
          <a
            href="#"
            className="hover:text-foreground text-muted-foreground text-sm"
          >
            Settings
          </a>
        </nav>
      </div>
      <Separator />
    </div>
  ),
};

export const ListWithSeparators: Story = {
  render: () => (
    <div className="bg-card w-80 rounded-md border p-4">
      {["Apple", "Banana", "Cherry", "Date", "Elderberry"].map(
        (item, index, arr) => (
          <div key={item}>
            <div className="py-2 text-sm">{item}</div>
            {index < arr.length - 1 && <Separator />}
          </div>
        ),
      )}
    </div>
  ),
};

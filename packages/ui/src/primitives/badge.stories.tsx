import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "./badge";

const meta = {
  title: "Primitives/Feedback/Badge",
  component: Badge,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "secondary", "destructive", "outline"],
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Badge",
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};

export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Active</Badge>
      <Badge variant="secondary">Pending</Badge>
      <Badge variant="destructive">Error</Badge>
      <Badge variant="outline">Draft</Badge>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default" className="gap-1 px-2 py-1">
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
        Verified
      </Badge>
      <Badge variant="destructive" className="gap-1 px-2 py-1">
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
        Failed
      </Badge>
      <Badge variant="secondary" className="gap-1 px-2 py-1">
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        In Progress
      </Badge>
    </div>
  ),
};

export const NotificationBadges: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm">Messages</span>
        <Badge
          variant="default"
          className="h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs"
        >
          3
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">Notifications</span>
        <Badge
          variant="destructive"
          className="h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs"
        >
          12
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">Updates</span>
        <Badge
          variant="secondary"
          className="h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs"
        >
          99+
        </Badge>
      </div>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge className="px-1.5 py-0.5 text-xs">Small</Badge>
        <span className="text-muted-foreground text-xs">Custom small size</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge>Default</Badge>
        <span className="text-muted-foreground text-xs">Default size</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge className="px-3 py-1.5 text-sm">Large</Badge>
        <span className="text-muted-foreground text-xs">Custom large size</span>
      </div>
    </div>
  ),
};

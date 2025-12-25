import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SharedTooltip } from "./Tooltip";
import { Button } from "../../primitives/button";
import {
  DatabaseIcon,
  PlusIcon,
  DeleteIcon,
  RefreshIcon,
  ChartIcon,
} from "../../lib/icons";

const meta = {
  title: "Components/Feedback/Tooltip",
  component: SharedTooltip,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof SharedTooltip>;

export default meta;
type Story = Omit<StoryObj<typeof meta>, "args"> & {
  args?: StoryObj<typeof meta>["args"];
};

/**
 * Default tooltip with text content
 */
export const Default: Story = {
  args: {
    content: "This is a tooltip",
    children: <Button variant="outlined">Hover me</Button>,
  },
};

/**
 * Tooltip on icon button
 */
export const IconButton: Story = {
  args: {
    content: "Add data source",
    children: (
      <Button size="icon" variant="outlined">
        <PlusIcon className="h-4 w-4" />
      </Button>
    ),
  },
};

/**
 * Tooltip on destructive button
 */
export const DestructiveButton: Story = {
  args: {
    content: "Delete permanently",
    children: (
      <Button size="icon" color="danger">
        <DeleteIcon className="h-4 w-4" />
      </Button>
    ),
  },
};

/**
 * Tooltip with longer content
 */
export const LongContent: Story = {
  args: {
    content:
      "This tooltip has longer content to demonstrate text wrapping behavior",
    children: <Button variant="outlined">Hover for long text</Button>,
  },
};

/**
 * Tooltip on icon-only action buttons
 */
export const IconOnlyActions: Story = {
  render: () => (
    <div className="flex gap-2">
      <SharedTooltip content="Add new item">
        <Button size="icon" variant="outlined">
          <PlusIcon className="h-4 w-4" />
        </Button>
      </SharedTooltip>

      <SharedTooltip content="Refresh data">
        <Button size="icon" variant="outlined">
          <RefreshIcon className="h-4 w-4" />
        </Button>
      </SharedTooltip>

      <SharedTooltip content="Delete item">
        <Button size="icon" color="danger">
          <DeleteIcon className="h-4 w-4" />
        </Button>
      </SharedTooltip>
    </div>
  ),
};

/**
 * Tooltip on text span
 */
export const OnTextSpan: Story = {
  args: {
    content: "Additional context about this term",
    children: (
      <span className="cursor-help text-sm underline decoration-dotted">
        Hover this text
      </span>
    ),
  },
};

/**
 * Tooltip on disabled-looking button
 */
export const DisabledContext: Story = {
  args: {
    content: "This feature is not available in the current plan",
    children: (
      <Button variant="outlined" disabled>
        Premium Feature
      </Button>
    ),
  },
};

/**
 * Tooltip with keyboard shortcut hint
 */
export const KeyboardShortcut: Story = {
  args: {
    content: "Save (Ctrl+S)",
    children: <Button>Save</Button>,
  },
};

/**
 * Tooltip on data source icon
 */
export const DataSourceIcon: Story = {
  args: {
    content: "PostgreSQL database",
    children: (
      <div className="bg-card border-border/60 hover:bg-muted/50 cursor-pointer rounded-xl border p-4 transition">
        <DatabaseIcon className="h-5 w-5" />
      </div>
    ),
  },
};

/**
 * Tooltip on chart type indicator
 */
export const ChartTypeIndicator: Story = {
  args: {
    content: "Bar chart visualization",
    children: (
      <div className="bg-primary/10 text-primary cursor-help rounded-full px-3 py-1 text-xs font-semibold">
        Bar
      </div>
    ),
  },
};

/**
 * Compact tooltip (DashFrame pattern)
 */
export const CompactStyle: Story = {
  args: {
    content: "Compact",
    children: (
      <Button size="icon" variant="text">
        <DatabaseIcon className="h-4 w-4" />
      </Button>
    ),
  },
};

/**
 * Multiple tooltips in a row
 */
export const MultipleTooltips: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <SharedTooltip content="Database connection">
        <Database className="h-4 w-4 cursor-help" />
      </SharedTooltip>

      <span className="text-sm font-medium">Sales Database</span>

      <SharedTooltip content="PostgreSQL">
        <span className="bg-muted text-muted-foreground cursor-help rounded-full px-2 text-[11px] font-semibold tracking-wide">
          PostgreSQL
        </span>
      </SharedTooltip>

      <SharedTooltip content="12 tables available">
        <span className="text-muted-foreground cursor-help text-xs">
          12 tables
        </span>
      </SharedTooltip>
    </div>
  ),
};

/**
 * Tooltip on badge
 */
export const OnBadge: Story = {
  args: {
    content: "1,250 rows in this dataset",
    children: (
      <span className="bg-muted text-muted-foreground cursor-help rounded-full px-2 text-[11px] font-semibold tracking-wide">
        1,250 rows
      </span>
    ),
  },
};

/**
 * Tooltip with status information
 */
export const StatusInfo: Story = {
  args: {
    content: "Connected to production database",
    children: (
      <div className="flex cursor-help items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-sm">Connected</span>
      </div>
    ),
  },
};

/**
 * Tooltip on compact icon buttons (DashFrame ActionGroup pattern)
 */
export const CompactActionButtons: Story = {
  render: () => (
    <div className="flex gap-2">
      <SharedTooltip content="Create visualization">
        <Button size="icon" className="h-9 w-9 rounded-full">
          <BarChart3 className="h-4 w-4" />
        </Button>
      </SharedTooltip>

      <SharedTooltip content="Add data source">
        <Button size="icon" variant="outlined" className="h-9 w-9 rounded-full">
          <PlusIcon className="h-4 w-4" />
        </Button>
      </SharedTooltip>

      <SharedTooltip content="Refresh all">
        <Button size="icon" variant="outlined" className="h-9 w-9 rounded-full">
          <RefreshIcon className="h-4 w-4" />
        </Button>
      </SharedTooltip>
    </div>
  ),
};

/**
 * Custom styled tooltip content
 */
export const CustomContent: Story = {
  args: {
    content: (
      <div className="flex flex-col gap-1">
        <div className="font-semibold">Advanced Info</div>
        <div className="text-[9px]">Multiple lines of tooltip content</div>
      </div>
    ),
    children: <Button variant="outlined">Complex tooltip</Button>,
  },
};

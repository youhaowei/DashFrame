import type { Meta, StoryObj } from "@storybook/react";
import { SharedTooltip } from "./Tooltip";
import { Button } from "../../primitives/button";
import { Database, Plus, Trash2, RefreshCw, BarChart3 } from "../../lib/icons";

const meta = {
  title: "Components/Feedback/Tooltip",
  component: SharedTooltip,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof SharedTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default tooltip with text content
 */
export const Default: Story = {
  args: {
    content: "This is a tooltip",
    children: <Button variant="outline">Hover me</Button>,
  },
};

/**
 * Tooltip on icon button
 */
export const IconButton: Story = {
  args: {
    content: "Add data source",
    children: (
      <Button size="icon" variant="outline">
        <Plus className="h-4 w-4" />
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
      <Button size="icon" variant="destructive">
        <Trash2 className="h-4 w-4" />
      </Button>
    ),
  },
};

/**
 * Tooltip with longer content
 */
export const LongContent: Story = {
  args: {
    content: "This tooltip has longer content to demonstrate text wrapping behavior",
    children: <Button variant="outline">Hover for long text</Button>,
  },
};

/**
 * Tooltip on icon-only action buttons
 */
export const IconOnlyActions: Story = {
  render: () => (
    <div className="flex gap-2">
      <SharedTooltip content="Add new item">
        <Button size="icon" variant="outline">
          <Plus className="h-4 w-4" />
        </Button>
      </SharedTooltip>

      <SharedTooltip content="Refresh data">
        <Button size="icon" variant="outline">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </SharedTooltip>

      <SharedTooltip content="Delete item">
        <Button size="icon" variant="destructive">
          <Trash2 className="h-4 w-4" />
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
      <span className="text-sm underline decoration-dotted cursor-help">
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
      <Button variant="outline" disabled>
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
      <div className="bg-card rounded-xl border border-border/60 p-4 cursor-pointer hover:bg-muted/50 transition">
        <Database className="h-5 w-5" />
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
      <div className="bg-primary/10 text-primary rounded-full px-3 py-1 text-xs font-semibold cursor-help">
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
      <Button size="icon" variant="ghost">
        <Database className="h-4 w-4" />
      </Button>
    ),
  },
};

/**
 * Multiple tooltips in a row
 */
export const MultipleTooltips: Story = {
  render: () => (
    <div className="flex gap-3 items-center">
      <SharedTooltip content="Database connection">
        <Database className="h-4 w-4 cursor-help" />
      </SharedTooltip>

      <span className="text-sm font-medium">Sales Database</span>

      <SharedTooltip content="PostgreSQL">
        <span className="bg-muted text-muted-foreground rounded-full px-2 text-[11px] font-semibold tracking-wide cursor-help">
          PostgreSQL
        </span>
      </SharedTooltip>

      <SharedTooltip content="12 tables available">
        <span className="text-muted-foreground text-xs cursor-help">
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
      <span className="bg-muted text-muted-foreground rounded-full px-2 text-[11px] font-semibold tracking-wide cursor-help">
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
      <div className="flex items-center gap-2 cursor-help">
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
        <Button size="icon" variant="outline" className="h-9 w-9 rounded-full">
          <Plus className="h-4 w-4" />
        </Button>
      </SharedTooltip>

      <SharedTooltip content="Refresh all">
        <Button size="icon" variant="outline" className="h-9 w-9 rounded-full">
          <RefreshCw className="h-4 w-4" />
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
    children: <Button variant="outline">Complex tooltip</Button>,
  },
};

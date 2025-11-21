import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./EmptyState";
import { Database, FileText, BarChart3, Layers, Plus } from "../lib/icons";

const meta = {
  title: "Components/Feedback/EmptyState",
  component: EmptyState,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "Size variant of the empty state",
    },
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default empty state with medium size
 */
export const Default: Story = {
  args: {
    icon: Database,
    title: "No data sources",
    description: "Get started by adding your first data source",
  },
};

/**
 * Empty state with action button
 */
export const WithAction: Story = {
  args: {
    icon: FileText,
    title: "No insights yet",
    description: "Create an insight to start exploring your data",
    action: {
      label: "Create insight",
      onClick: () => alert("Create insight clicked"),
      icon: Plus,
    },
  },
};

/**
 * Small size variant (compact)
 */
export const SmallSize: Story = {
  args: {
    icon: BarChart3,
    title: "No results",
    description: "Try adjusting your search",
    size: "sm",
  },
};

/**
 * Large size variant (spacious)
 */
export const LargeSize: Story = {
  args: {
    icon: Database,
    title: "No data sources connected",
    description: "Connect a data source to start building visualizations and insights",
    size: "lg",
    action: {
      label: "Add Data Source",
      onClick: () => alert("Add data source"),
      icon: Plus,
    },
  },
};

/**
 * No data sources (DashFrame specific)
 */
export const NoDataSources: Story = {
  args: {
    icon: Database,
    title: "No data sources",
    description: "Connect to a database or upload a CSV file to get started",
    action: {
      label: "Add Data Source",
      onClick: () => alert("Add clicked"),
      icon: Plus,
      variant: "default",
    },
  },
};

/**
 * No insights (DashFrame specific)
 */
export const NoInsights: Story = {
  args: {
    icon: Layers,
    title: "No insights yet",
    description: "Create your first insight to start analyzing your data",
    action: {
      label: "Create Insight",
      onClick: () => alert("Create clicked"),
      icon: Plus,
    },
  },
};

/**
 * No visualizations (DashFrame specific)
 */
export const NoVisualizations: Story = {
  args: {
    icon: BarChart3,
    title: "No visualizations",
    description: "Select an insight and create your first chart",
    action: {
      label: "Create Visualization",
      onClick: () => alert("Create clicked"),
      icon: Plus,
    },
  },
};

/**
 * Empty search results
 */
export const EmptySearchResults: Story = {
  args: {
    icon: FileText,
    title: "No results found",
    description: "Try different keywords or check your filters",
    size: "sm",
  },
};

/**
 * Without description (title only)
 */
export const TitleOnly: Story = {
  args: {
    icon: Database,
    title: "No items",
  },
};

/**
 * With secondary action variant
 */
export const SecondaryAction: Story = {
  args: {
    icon: Database,
    title: "No recent data sources",
    description: "You haven't used any data sources recently",
    action: {
      label: "Browse All",
      onClick: () => alert("Browse clicked"),
      variant: "secondary",
    },
  },
};

/**
 * With outline action variant
 */
export const OutlineAction: Story = {
  args: {
    icon: Layers,
    title: "No active insights",
    description: "All insights are currently archived",
    action: {
      label: "View Archive",
      onClick: () => alert("Archive clicked"),
      variant: "outline",
    },
  },
};

/**
 * No data tables (DashFrame specific)
 */
export const NoDataTables: Story = {
  args: {
    icon: FileText,
    title: "No tables found",
    description: "This data source doesn't contain any tables or they couldn't be loaded",
    size: "sm",
  },
};

/**
 * Empty DataFrame
 */
export const EmptyDataFrame: Story = {
  args: {
    icon: FileText,
    title: "No data",
    description: "This DataFrame is empty or hasn't been loaded yet",
    size: "md",
    action: {
      label: "Reload Data",
      onClick: () => alert("Reload clicked"),
      icon: Plus,
    },
  },
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LoadingState } from "./LoadingState";

const meta = {
  title: "Components/Feedback/LoadingState",
  component: LoadingState,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "Size variant of the loading state",
    },
  },
} satisfies Meta<typeof LoadingState>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default loading state with medium size
 */
export const Default: Story = {
  args: {
    title: "Loading...",
  },
};

/**
 * Loading state with description
 */
export const WithDescription: Story = {
  args: {
    title: "Loading data",
    description: "Please wait while we fetch your data",
  },
};

/**
 * Small size variant (compact)
 */
export const SmallSize: Story = {
  args: {
    title: "Loading...",
    size: "sm",
  },
};

/**
 * Medium size variant (default)
 */
export const MediumSize: Story = {
  args: {
    title: "Loading data",
    description: "This may take a moment",
    size: "md",
  },
};

/**
 * Large size variant (spacious)
 */
export const LargeSize: Story = {
  args: {
    title: "Loading your dashboard",
    description: "Preparing visualizations and fetching data from all sources",
    size: "lg",
  },
};

/**
 * Data sources loading (DashFrame specific)
 */
export const DataSourcesLoading: Story = {
  args: {
    title: "Loading data sources",
    description: "Connecting to your databases and files",
  },
};

/**
 * Chart loading (DashFrame specific)
 */
export const ChartLoading: Story = {
  args: {
    title: "Rendering chart",
    description: "Processing data and generating visualization",
    size: "md",
  },
};

/**
 * Table loading (DashFrame specific)
 */
export const TableLoading: Story = {
  args: {
    title: "Loading table data",
    description: "Fetching rows from your data source",
    size: "sm",
  },
};

/**
 * Insights loading (DashFrame specific)
 */
export const InsightsLoading: Story = {
  args: {
    title: "Loading insights",
    description: "Retrieving your saved queries and configurations",
  },
};

/**
 * Query execution loading
 */
export const QueryExecuting: Story = {
  args: {
    title: "Executing query",
    description: "Running your query against the database",
    size: "md",
  },
};

/**
 * Initial app loading
 */
export const InitialLoading: Story = {
  args: {
    title: "Starting up",
    description: "Initializing application components",
    size: "lg",
  },
};

/**
 * Compact loading indicator (title only, small)
 */
export const CompactLoading: Story = {
  args: {
    title: "Loading...",
    size: "sm",
  },
};

/**
 * File upload processing
 */
export const FileProcessing: Story = {
  args: {
    title: "Processing file",
    description: "Analyzing structure and importing data",
  },
};

/**
 * Search in progress
 */
export const SearchLoading: Story = {
  args: {
    title: "Searching",
    description: "Looking for matching results",
    size: "sm",
  },
};

/**
 * Dashboard loading
 */
export const DashboardLoading: Story = {
  args: {
    title: "Loading dashboard",
    description: "Fetching all widgets and data",
    size: "lg",
  },
};

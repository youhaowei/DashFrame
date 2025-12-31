import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ErrorState } from "./ErrorState";

const meta = {
  title: "Components/Feedback/ErrorState",
  component: ErrorState,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "Size variant of the error state",
    },
  },
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default error state with medium size
 */
export const Default: Story = {
  args: {
    title: "Something went wrong",
  },
};

/**
 * Error state with description
 */
export const WithDescription: Story = {
  args: {
    title: "Failed to load data",
    description: "An error occurred while fetching the data. Please try again.",
  },
};

/**
 * Error state with retry action
 */
export const WithRetryAction: Story = {
  args: {
    title: "Connection error",
    description: "Unable to connect to the server",
    retryAction: {
      label: "Try again",
      onClick: () => alert("Retry clicked"),
    },
  },
};

/**
 * Small size variant (compact)
 */
export const SmallSize: Story = {
  args: {
    title: "Error",
    description: "Something went wrong",
    size: "sm",
  },
};

/**
 * Medium size variant (default)
 */
export const MediumSize: Story = {
  args: {
    title: "Failed to load",
    description: "An unexpected error occurred",
    size: "md",
  },
};

/**
 * Large size variant (spacious)
 */
export const LargeSize: Story = {
  args: {
    title: "Unable to load dashboard",
    description:
      "We encountered an error while loading your dashboard. This may be due to a temporary server issue.",
    size: "lg",
    retryAction: {
      label: "Reload dashboard",
      onClick: () => alert("Reload clicked"),
    },
  },
};

/**
 * Network error scenario
 */
export const NetworkError: Story = {
  args: {
    title: "Network error",
    description:
      "Please check your internet connection and try again. If the problem persists, contact support.",
    retryAction: {
      label: "Retry connection",
      onClick: () => alert("Retry connection clicked"),
    },
  },
};

/**
 * Data source connection error (DashFrame specific)
 */
export const DataSourceError: Story = {
  args: {
    title: "Failed to connect to data source",
    description:
      "Unable to establish connection to the database. Please verify your credentials and try again.",
    retryAction: {
      label: "Reconnect",
      onClick: () => alert("Reconnect clicked"),
    },
  },
};

/**
 * Query execution error (DashFrame specific)
 */
export const QueryError: Story = {
  args: {
    title: "Query execution failed",
    description:
      "The query could not be executed. Please check your syntax and try again.",
    retryAction: {
      label: "Run again",
      onClick: () => alert("Run again clicked"),
    },
    size: "md",
  },
};

/**
 * Chart rendering error (DashFrame specific)
 */
export const ChartError: Story = {
  args: {
    title: "Failed to render chart",
    description:
      "An error occurred while generating the visualization. The data format may be incompatible.",
    retryAction: {
      label: "Retry",
      onClick: () => alert("Retry clicked"),
    },
  },
};

/**
 * Table loading error (DashFrame specific)
 */
export const TableError: Story = {
  args: {
    title: "Failed to load table",
    description: "Unable to fetch table data from the data source",
    size: "sm",
    retryAction: {
      label: "Reload",
      onClick: () => alert("Reload clicked"),
    },
  },
};

/**
 * File upload error
 */
export const FileUploadError: Story = {
  args: {
    title: "File upload failed",
    description:
      "The file could not be uploaded. Please ensure the file is not corrupted and try again.",
    retryAction: {
      label: "Upload again",
      onClick: () => alert("Upload again clicked"),
    },
  },
};

/**
 * Authentication error
 */
export const AuthenticationError: Story = {
  args: {
    title: "Authentication failed",
    description:
      "Your session has expired. Please log in again to continue.",
    retryAction: {
      label: "Log in",
      onClick: () => alert("Log in clicked"),
    },
  },
};

/**
 * Permission denied error
 */
export const PermissionError: Story = {
  args: {
    title: "Access denied",
    description:
      "You don't have permission to access this resource. Contact your administrator for access.",
  },
};

/**
 * Server error (500)
 */
export const ServerError: Story = {
  args: {
    title: "Server error",
    description:
      "An internal server error occurred. Our team has been notified and is working on a fix.",
    size: "lg",
    retryAction: {
      label: "Try again",
      onClick: () => alert("Try again clicked"),
    },
  },
};

/**
 * Compact error (title only, small)
 */
export const CompactError: Story = {
  args: {
    title: "Error loading",
    size: "sm",
  },
};

/**
 * Insight loading error (DashFrame specific)
 */
export const InsightError: Story = {
  args: {
    title: "Failed to load insight",
    description: "Unable to retrieve the insight configuration",
    retryAction: {
      label: "Reload insight",
      onClick: () => alert("Reload insight clicked"),
    },
  },
};

/**
 * Timeout error
 */
export const TimeoutError: Story = {
  args: {
    title: "Request timed out",
    description:
      "The request took too long to complete. This might be due to a slow connection or server load.",
    retryAction: {
      label: "Try again",
      onClick: () => alert("Try again clicked"),
    },
  },
};

/**
 * Not found error (404)
 */
export const NotFoundError: Story = {
  args: {
    title: "Resource not found",
    description:
      "The requested resource could not be found. It may have been moved or deleted.",
    size: "md",
  },
};

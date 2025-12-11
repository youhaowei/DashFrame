import type { Meta, StoryObj } from "@storybook/react";
import { ItemCard } from "./item-card";
import { Database, Chart, LineChart, Table, Edit, Delete } from "../lib/icons";

const meta = {
  title: "Primitives/Cards/ItemCard",
  component: ItemCard,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    icon: {
      description: "Icon element to display",
      control: false,
    },
    title: {
      description: "Primary title text",
      control: "text",
    },
    subtitle: {
      description: "Optional subtitle",
      control: "text",
    },
    badge: {
      description: "Optional badge text",
      control: "text",
    },
    onClick: {
      description: "Optional click handler",
      action: "clicked",
    },
    active: {
      description: "Whether card is active/selected",
      control: "boolean",
    },
    preview: {
      description: "Optional preview element",
      control: false,
    },
    previewHeight: {
      description: "Height of preview section in pixels",
      control: { type: "number", min: 100, max: 400, step: 10 },
    },
    actions: {
      description: "Optional action buttons",
      control: false,
    },
  },
} satisfies Meta<typeof ItemCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock preview component
const MockPreview = ({ type }: { type: string }) => (
  <div className="from-primary/10 to-primary/5 flex h-full w-full items-center justify-center bg-gradient-to-br">
    <div className="text-center">
      <div className="mb-2 text-4xl">📊</div>
      <div className="text-muted-foreground text-xs">{type} Preview</div>
    </div>
  </div>
);

// Basic compact mode
export const Compact: Story = {
  args: {
    icon: <Database className="h-4 w-4" />,
    title: "Sales Data",
    subtitle: "150 rows × 8 columns",
    onClick: undefined,
  },
};

export const CompactWithBadge: Story = {
  args: {
    icon: <Database className="h-4 w-4" />,
    title: "Customer Database",
    subtitle: "1,234 rows",
    badge: "CSV",
    onClick: undefined,
  },
};

export const CompactClickable: Story = {
  args: {
    icon: <Chart className="h-4 w-4" />,
    title: "Revenue Chart",
    subtitle: "Created Jan 15",
    badge: "Bar Chart",
  },
};

export const CompactActive: Story = {
  args: {
    icon: <Database className="h-4 w-4" />,
    title: "Active Item",
    subtitle: "Currently selected",
    active: true,
  },
};

export const CompactWithActions: Story = {
  args: {
    icon: <Table className="h-4 w-4" />,
    title: "Data Table",
    subtitle: "500 rows",
    actions: [
      { label: "Edit", icon: Edit, onClick: () => alert("Edit") },
      {
        label: "Delete",
        icon: Delete,
        onClick: () => alert("Delete"),
        variant: "destructive",
      },
    ],
  },
};

// Preview mode
export const WithPreview: Story = {
  args: {
    preview: <MockPreview type="Bar Chart" />,
    icon: <Chart className="h-8 w-8" />,
    title: "Sales by Region",
    subtitle: "Created Jan 15, 2025",
    badge: "Bar Chart",
  },
};

export const WithPreviewActive: Story = {
  args: {
    preview: <MockPreview type="Line Chart" />,
    icon: <LineChart className="h-8 w-8" />,
    title: "Revenue Trends",
    subtitle: "Last 30 days",
    badge: "Line Chart",
    active: true,
  },
};

export const WithPreviewAndActions: Story = {
  args: {
    preview: <MockPreview type="Scatter Plot" />,
    icon: <Chart className="h-8 w-8" />,
    title: "Correlation Analysis",
    subtitle: "Updated 2h ago",
    badge: "Scatter",
    actions: [
      { label: "Open", icon: Edit, onClick: () => alert("Open") },
      {
        label: "Delete",
        icon: Delete,
        onClick: () => alert("Delete"),
        variant: "destructive",
      },
    ],
  },
};

export const WithPreviewCustomHeight: Story = {
  args: {
    preview: <MockPreview type="Custom Height" />,
    icon: <Chart className="h-8 w-8" />,
    title: "Tall Preview",
    subtitle: "300px height",
    badge: "Custom",
    previewHeight: 300,
  },
};

// Edge cases
export const LongText: Story = {
  args: {
    icon: <Database className="h-4 w-4" />,
    title:
      "This is a very long title that should truncate with ellipsis when it exceeds the card width limits",
    subtitle:
      "This is also a very long subtitle that should also truncate to prevent breaking the layout",
    badge: "Very Long Badge Text Here",
  },
};

export const NoSubtitle: Story = {
  args: {
    icon: <Chart className="h-4 w-4" />,
    title: "Simple Card",
    badge: "Minimal",
  },
};

export const NoBadge: Story = {
  args: {
    icon: <LineChart className="h-4 w-4" />,
    title: "Card Without Badge",
    subtitle: "Just title and subtitle",
  },
};

// Grid layout
export const GridCompact: Story = {
  args: {
    icon: <Database className="h-4 w-4" />,
    title: "Grid Example",
  },
  render: () => (
    <div className="grid w-[600px] grid-cols-2 gap-3">
      <ItemCard
        icon={<Database className="h-4 w-4" />}
        title="Sales Data"
        subtitle="150 rows"
        badge="CSV"
        onClick={() => alert("Sales")}
      />
      <ItemCard
        icon={<Chart className="h-4 w-4" />}
        title="Revenue Chart"
        subtitle="Created today"
        badge="Bar"
        onClick={() => alert("Revenue")}
        active
      />
      <ItemCard
        icon={<LineChart className="h-4 w-4" />}
        title="Trends"
        subtitle="Last 30 days"
        actions={[
          { label: "Edit", icon: Edit, onClick: () => alert("Edit") },
          {
            label: "Delete",
            icon: Delete,
            onClick: () => alert("Delete"),
            variant: "destructive",
          },
        ]}
      />
      <ItemCard
        icon={<Table className="h-4 w-4" />}
        title="Data Table"
        subtitle="1,000 rows"
        onClick={() => alert("Table")}
      />
    </div>
  ),
};

export const GridWithPreview: Story = {
  args: {
    icon: <Chart className="h-8 w-8" />,
    title: "Grid with Preview Example",
  },
  render: () => (
    <div className="grid w-[900px] grid-cols-3 gap-4">
      <ItemCard
        preview={<MockPreview type="Bar" />}
        icon={<Chart className="h-8 w-8" />}
        title="Sales Analysis"
        subtitle="Created today"
        badge="Bar Chart"
        onClick={() => alert("Sales")}
      />
      <ItemCard
        preview={<MockPreview type="Line" />}
        icon={<LineChart className="h-8 w-8" />}
        title="Revenue Trends"
        subtitle="Updated 1h ago"
        badge="Line Chart"
        onClick={() => alert("Revenue")}
        active
      />
      <ItemCard
        preview={<MockPreview type="Scatter" />}
        icon={<Chart className="h-8 w-8" />}
        title="Correlation"
        subtitle="Last week"
        badge="Scatter"
        actions={[
          { label: "Open", icon: Edit, onClick: () => alert("Open") },
          {
            label: "Delete",
            icon: Delete,
            onClick: () => alert("Delete"),
            variant: "destructive",
          },
        ]}
      />
    </div>
  ),
};

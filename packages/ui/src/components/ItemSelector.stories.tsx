import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import {
  ChartIcon,
  DatabaseIcon,
  DeleteIcon,
  FileIcon,
  PlusIcon,
  RefreshIcon,
} from "../lib/icons";
import { ItemSelector, type SelectableItem } from "./ItemSelector";

const meta = {
  title: "Components/Selection/ItemSelector",
  component: ItemSelector,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ItemSelector>;

export default meta;
type Story = Omit<StoryObj<typeof meta>, "args"> & {
  args?: StoryObj<typeof meta>["args"];
};

/**
 * Default ItemSelector with data sources
 */
export const Default: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Sales Database",
        active: true,
        badge: "PostgreSQL",
        metadata: "12 tables",
        icon: DatabaseIcon,
      },
      {
        id: "2",
        label: "Analytics DB",
        active: false,
        badge: "MongoDB",
        metadata: "8 collections",
        icon: DatabaseIcon,
      },
      {
        id: "3",
        label: "Customer Data",
        active: false,
        badge: "CSV",
        metadata: "5,420 rows",
        icon: FileIcon,
      },
    ]);

    return (
      <ItemSelector
        {...args}
        title="Data Sources"
        description="Select a data source to view details"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "Manage Data",
            onClick: () => alert("Manage"),
            variant: "outlined",
          },
          {
            label: "New",
            onClick: () => alert("New"),
            icon: PlusIcon,
          },
        ]}
      />
    );
  },
};

/**
 * Visualizations selector
 */
export const Visualizations: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Sales by Region",
        active: true,
        badge: "Bar",
        metadata: "1,250 rows",
        icon: ChartIcon,
      },
      {
        id: "2",
        label: "Revenue Trend",
        active: false,
        badge: "Line",
        metadata: "365 rows",
        icon: ChartIcon,
      },
      {
        id: "3",
        label: "Customer Distribution",
        active: false,
        badge: "Pie",
        metadata: "8 categories",
        icon: ChartIcon,
      },
    ]);

    return (
      <ItemSelector
        {...args}
        title="Visualizations"
        description="Select a visualization to edit"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "Create",
            onClick: () => alert("Create"),
            icon: PlusIcon,
          },
        ]}
      />
    );
  },
};

/**
 * Compact view using Toggle component
 */
export const CompactView: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Q1 2024",
        active: true,
        badge: "Jan-Mar",
        metadata: "3 months",
      },
      {
        id: "2",
        label: "Q2 2024",
        active: false,
        badge: "Apr-Jun",
        metadata: "3 months",
      },
      {
        id: "3",
        label: "Q3 2024",
        active: false,
        badge: "Jul-Sep",
        metadata: "3 months",
      },
      {
        id: "4",
        label: "Q4 2024",
        active: false,
        badge: "Oct-Dec",
        metadata: "3 months",
      },
    ]);

    return (
      <ItemSelector
        {...args}
        title="Quarters"
        description="Select a quarter to view data"
        defaultViewStyle="compact"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "Export",
            onClick: () => alert("Export"),
            variant: "outlined",
          },
        ]}
      />
    );
  },
};

/**
 * Insights selector
 */
export const Insights: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Q4 Sales Analysis",
        active: true,
        badge: "DataFrame",
        metadata: "2,500 rows",
        icon: FileIcon,
      },
      {
        id: "2",
        label: "Customer Segmentation",
        active: false,
        badge: "DataFrame",
        metadata: "1,820 rows",
        icon: FileIcon,
      },
    ]);

    return (
      <ItemSelector
        {...args}
        title="Insights"
        description="Analyzed data ready for visualization"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "Refresh",
            onClick: () => alert("Refresh"),
            icon: RefreshIcon,
            variant: "outlined",
          },
          {
            label: "New Insight",
            onClick: () => alert("New"),
            icon: PlusIcon,
          },
        ]}
      />
    );
  },
};

/**
 * Empty state (no items)
 */
export const EmptyState: Story = {
  args: {
    title: "Data Sources",
    description: "No data sources available",
    items: [],
    onItemSelect: () => {},
    actions: [
      {
        label: "Add Data Source",
        onClick: () => alert("Add"),
        icon: PlusIcon,
      },
    ],
  },
};

/**
 * Single item
 */
export const SingleItem: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Sales Database",
        active: true,
        badge: "PostgreSQL",
        metadata: "12 tables",
        icon: DatabaseIcon,
      },
    ]);

    return (
      <ItemSelector
        {...args}
        title="Data Sources"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "Settings",
            onClick: () => alert("Settings"),
            variant: "outlined",
          },
        ]}
      />
    );
  },
};

/**
 * Many items (scrollable)
 */
export const ManyItems: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>(
      Array.from({ length: 10 }, (_, i) => ({
        id: `${i + 1}`,
        label: `Data Source ${i + 1}`,
        active: i === 0,
        badge: i % 2 === 0 ? "PostgreSQL" : "MySQL",
        // eslint-disable-next-line sonarjs/pseudo-random
        metadata: `${Math.floor(Math.random() * 50) + 1} tables`,
        icon: DatabaseIcon,
      })),
    );

    return (
      <ItemSelector
        {...args}
        title="Data Sources"
        description="Select a data source to view details"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "Manage",
            onClick: () => alert("Manage"),
            variant: "outlined",
          },
          {
            label: "New",
            onClick: () => alert("New"),
            icon: PlusIcon,
          },
        ]}
      />
    );
  },
};

/**
 * Without description
 */
export const WithoutDescription: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Sales Database",
        active: true,
        badge: "PostgreSQL",
        icon: DatabaseIcon,
      },
      {
        id: "2",
        label: "Analytics DB",
        active: false,
        badge: "MongoDB",
        icon: DatabaseIcon,
      },
    ]);

    return (
      <ItemSelector
        {...args}
        title="Data Sources"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "New",
            onClick: () => alert("New"),
            icon: PlusIcon,
          },
        ]}
      />
    );
  },
};

/**
 * With multiple actions
 */
export const MultipleActions: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Sales Database",
        active: true,
        badge: "PostgreSQL",
        metadata: "12 tables",
        icon: DatabaseIcon,
      },
    ]);

    return (
      <ItemSelector
        {...args}
        title="Data Sources"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "Refresh",
            onClick: () => alert("Refresh"),
            icon: RefreshIcon,
            variant: "outlined",
          },
          {
            label: "Delete",
            onClick: () => alert("Delete"),
            icon: DeleteIcon,
            color: "danger",
          },
          {
            label: "New",
            onClick: () => alert("New"),
            icon: PlusIcon,
          },
        ]}
      />
    );
  },
};

/**
 * Items without icons
 */
export const WithoutIcons: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Q1 2024",
        active: true,
        badge: "Jan-Mar",
        metadata: "3 months",
      },
      {
        id: "2",
        label: "Q2 2024",
        active: false,
        badge: "Apr-Jun",
        metadata: "3 months",
      },
      {
        id: "3",
        label: "Q3 2024",
        active: false,
        badge: "Jul-Sep",
        metadata: "3 months",
      },
    ]);

    return (
      <ItemSelector
        {...args}
        title="Quarters"
        description="Select a quarter to analyze"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "Compare",
            onClick: () => alert("Compare"),
            variant: "outlined",
          },
        ]}
      />
    );
  },
};

/**
 * Items without badges
 */
export const WithoutBadges: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Sales Database",
        active: true,
        metadata: "12 tables",
        icon: DatabaseIcon,
      },
      {
        id: "2",
        label: "Analytics DB",
        active: false,
        metadata: "8 collections",
        icon: DatabaseIcon,
      },
    ]);

    return (
      <ItemSelector
        {...args}
        title="Data Sources"
        items={items}
        onItemSelect={(id) => {
          setItems(items.map((item) => ({ ...item, active: item.id === id })));
        }}
        actions={[
          {
            label: "New",
            onClick: () => alert("New"),
            icon: PlusIcon,
          },
        ]}
      />
    );
  },
};

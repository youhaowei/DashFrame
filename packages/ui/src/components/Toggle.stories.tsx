import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Toggle } from "./Toggle";
import {
  Chart,
  Table,
  List,
  LayoutGrid,
  Hash,
  Type,
  Calendar,
} from "../lib/icons";

const meta = {
  title: "Components/Actions/Toggle",
  component: Toggle,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline"],
      description: "Visual variant of the toggle",
    },
    size: {
      control: "select",
      options: ["default", "sm"],
      description: "Size of the toggle",
    },
  },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = Omit<StoryObj<typeof meta>, "args"> & {
  args?: StoryObj<typeof meta>["args"];
};

/**
 * Default variant with icons and labels
 */
export const Default: Story = {
  render: (args) => {
    const [value, setValue] = useState("chart");
    return (
      <Toggle
        {...args}
        variant="default"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "chart",
            icon: <Chart className="h-4 w-4" />,
            label: "Chart",
          },
          {
            value: "table",
            icon: <Table className="h-4 w-4" />,
            label: "Data Table",
          },
          { value: "both", label: "Both" },
        ]}
      />
    );
  },
};

/**
 * Outline variant with icons only (compact)
 */
export const OutlineIconsOnly: Story = {
  render: (args) => {
    const [value, setValue] = useState("compact");
    return (
      <Toggle
        {...args}
        variant="outline"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "compact",
            icon: <List className="h-4 w-4" />,
            tooltip: "Compact view",
          },
          {
            value: "expanded",
            icon: <LayoutGrid className="h-4 w-4" />,
            tooltip: "Expanded view",
          },
        ]}
      />
    );
  },
};

/**
 * Toggle with icons and labels
 */
export const IconsAndLabels: Story = {
  render: (args) => {
    const [value, setValue] = useState("chart");
    return (
      <Toggle
        {...args}
        variant="default"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "chart",
            icon: <Chart className="h-4 w-4" />,
            label: "Chart",
          },
          {
            value: "table",
            icon: <Table className="h-4 w-4" />,
            label: "Table",
            badge: 100,
          },
        ]}
      />
    );
  },
};

/**
 * Outline variant with icons and labels (compact style)
 */
export const OutlineIconsAndLabels: Story = {
  render: (args) => {
    const [value, setValue] = useState("chart");
    return (
      <Toggle
        {...args}
        variant="outline"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "chart",
            icon: <Chart className="h-4 w-4" />,
            label: "Chart",
          },
          {
            value: "table",
            icon: <Table className="h-4 w-4" />,
            label: "Table",
          },
        ]}
      />
    );
  },
};

/**
 * Toggle with badges
 */
export const WithBadges: Story = {
  render: (args) => {
    const [value, setValue] = useState("table");
    return (
      <Toggle
        {...args}
        variant="default"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "chart",
            icon: <Chart className="h-4 w-4" />,
            label: "Chart",
          },
          {
            value: "table",
            icon: <Table className="h-4 w-4" />,
            label: "Data Table",
            badge: 1250,
          },
          {
            value: "both",
            label: "Both",
            badge: "New",
          },
        ]}
      />
    );
  },
};

/**
 * Small size variant
 */
export const SmallSize: Story = {
  render: (args) => {
    const [value, setValue] = useState("compact");
    return (
      <Toggle
        {...args}
        variant="outline"
        size="sm"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "compact",
            icon: <List className="h-3 w-3" />,
            tooltip: "Compact view",
          },
          {
            value: "expanded",
            icon: <LayoutGrid className="h-3 w-3" />,
            tooltip: "Expanded view",
          },
        ]}
      />
    );
  },
};

/**
 * Chart type selection
 */
export const ChartTypeSelection: Story = {
  render: (args) => {
    const [value, setValue] = useState("bar");
    return (
      <Toggle
        {...args}
        variant="default"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "bar",
            icon: <Chart className="h-4 w-4" />,
            label: "Bar",
          },
          {
            value: "line",
            icon: <Chart className="h-4 w-4" />,
            label: "Line",
          },
          {
            value: "area",
            icon: <Chart className="h-4 w-4" />,
            label: "Area",
          },
        ]}
      />
    );
  },
};

/**
 * Data type selection
 */
export const DataTypeSelection: Story = {
  render: (args) => {
    const [value, setValue] = useState("number");
    return (
      <Toggle
        {...args}
        variant="default"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "text",
            icon: <Type className="h-4 w-4" />,
            label: "Text",
          },
          {
            value: "number",
            icon: <Hash className="h-4 w-4" />,
            label: "Number",
          },
          {
            value: "date",
            icon: <Calendar className="h-4 w-4" />,
            label: "Date",
          },
        ]}
      />
    );
  },
};

/**
 * Axis type toggle
 */
export const AxisTypeToggle: Story = {
  render: (args) => {
    const [value, setValue] = useState("linear");
    return (
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium">X-Axis Scale</label>
          <Toggle
            {...args}
            variant="outline"
            value={value}
            onValueChange={setValue}
            options={[
              { value: "linear", label: "Linear" },
              { value: "log", label: "Logarithmic" },
            ]}
          />
        </div>
      </div>
    );
  },
};

/**
 * View style toggle with tooltips
 */
export const ViewStyleToggle: Story = {
  render: (args) => {
    const [value, setValue] = useState("grid");
    return (
      <Toggle
        {...args}
        variant="outline"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "list",
            icon: <List className="h-4 w-4" />,
            tooltip: "List view",
            ariaLabel: "Switch to list view",
          },
          {
            value: "grid",
            icon: <LayoutGrid className="h-4 w-4" />,
            tooltip: "Grid view",
            ariaLabel: "Switch to grid view",
          },
        ]}
      />
    );
  },
};

/**
 * Toggle with disabled option
 */
export const WithDisabledOption: Story = {
  render: (args) => {
    const [value, setValue] = useState("chart");
    return (
      <Toggle
        {...args}
        variant="default"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "chart",
            icon: <Chart className="h-4 w-4" />,
            label: "Chart",
          },
          {
            value: "table",
            icon: <Table className="h-4 w-4" />,
            label: "Table",
            disabled: true,
            tooltip: "Table view is disabled",
          },
          {
            value: "both",
            label: "Both",
          },
        ]}
      />
    );
  },
};

/**
 * Small outline toggle (most compact)
 */
export const SmallOutlineCompact: Story = {
  render: (args) => {
    const [value, setValue] = useState("expanded");
    return (
      <Toggle
        {...args}
        variant="outline"
        size="sm"
        value={value}
        onValueChange={setValue}
        options={[
          {
            value: "compact",
            icon: <List className="h-3 w-3" />,
            tooltip: "Compact",
          },
          {
            value: "expanded",
            icon: <LayoutGrid className="h-3 w-3" />,
            tooltip: "Expanded",
          },
        ]}
      />
    );
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { MultiSelect } from "./multi-select";
import { useState } from "react";

const meta = {
  title: "Primitives/Forms/MultiSelect",
  component: MultiSelect,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    disabled: {
      control: "boolean",
    },
    maxLines: {
      control: "number",
    },
  },
} satisfies Meta<typeof MultiSelect>;

export default meta;
type Story = Omit<StoryObj<typeof meta>, "args"> & {
  args?: StoryObj<typeof meta>["args"];
};

const basicOptions = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
  { value: "angular", label: "Angular" },
  { value: "svelte", label: "Svelte" },
  { value: "solid", label: "Solid" },
];

const columnOptions = [
  { value: "name", label: "Name", type: "string" as const, description: "User full name" },
  { value: "age", label: "Age", type: "number" as const, description: "User age in years" },
  { value: "email", label: "Email", type: "string" as const, description: "Contact email" },
  { value: "created_at", label: "Created At", type: "date" as const, description: "Account creation date" },
  { value: "is_active", label: "Is Active", type: "boolean" as const, description: "Account status" },
  { value: "balance", label: "Balance", type: "number" as const, description: "Account balance" },
  { value: "metadata", label: "Metadata", type: "object" as const, description: "Additional data" },
];

const manyOptions = Array.from({ length: 30 }, (_, i) => ({
  value: `option-${i + 1}`,
  label: `Option ${i + 1}`,
  description: `Description for option ${i + 1}`,
}));

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState<string[]>([]);
    return (
      <div className="w-80">
        <MultiSelect
          options={basicOptions}
          value={value}
          onChange={setValue}
          placeholder="Select frameworks..."
        />
      </div>
    );
  },
};

export const WithSelectedItems: Story = {
  render: () => {
    const [value, setValue] = useState<string[]>(["react", "vue"]);
    return (
      <div className="w-80">
        <MultiSelect
          options={basicOptions}
          value={value}
          onChange={setValue}
          placeholder="Select frameworks..."
        />
      </div>
    );
  },
};

export const WithDataTypes: Story = {
  render: () => {
    const [value, setValue] = useState<string[]>(["name", "email", "is_active"]);
    return (
      <div className="w-96">
        <MultiSelect
          options={columnOptions}
          value={value}
          onChange={setValue}
          placeholder="Select columns..."
        />
      </div>
    );
  },
};

export const ManyOptions: Story = {
  render: () => {
    const [value, setValue] = useState<string[]>([
      "option-1",
      "option-5",
      "option-10",
      "option-15",
      "option-20",
    ]);
    return (
      <div className="w-96">
        <MultiSelect
          options={manyOptions}
          value={value}
          onChange={setValue}
          placeholder="Select options..."
        />
      </div>
    );
  },
};

export const OverflowingWithMaxLines: Story = {
  render: () => {
    const [value, setValue] = useState<string[]>([
      "option-1",
      "option-2",
      "option-3",
      "option-4",
      "option-5",
      "option-6",
      "option-7",
      "option-8",
    ]);
    return (
      <div className="w-96">
        <MultiSelect
          options={manyOptions}
          value={value}
          onChange={setValue}
          placeholder="Select options..."
          maxLines={2}
        />
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => {
    const [value, setValue] = useState<string[]>(["react", "vue"]);
    return (
      <div className="w-80">
        <MultiSelect
          options={basicOptions}
          value={value}
          onChange={setValue}
          placeholder="Select frameworks..."
          disabled
        />
      </div>
    );
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { Surface } from "./surface";

const meta = {
  title: "Primitives/Layout/Surface",
  component: Surface,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    elevation: {
      control: "select",
      options: ["plain", "raised", "floating", "inset"],
    },
    interactive: {
      control: "boolean",
    },
  },
} satisfies Meta<typeof Surface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    elevation: "raised",
    className: "p-6 w-[300px]",
    children: "Default surface with raised elevation",
  },
};

export const AllElevations: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6">
      <Surface elevation="plain" className="p-6 w-[200px]">
        <h3 className="font-semibold mb-2">Plain</h3>
        <p className="text-sm text-muted-foreground">
          Minimal flat surface with border only
        </p>
      </Surface>
      <Surface elevation="raised" className="p-6 w-[200px]">
        <h3 className="font-semibold mb-2">Raised</h3>
        <p className="text-sm text-muted-foreground">
          Standard elevated surface with subtle shadow
        </p>
      </Surface>
      <Surface elevation="floating" className="p-6 w-[200px]">
        <h3 className="font-semibold mb-2">Floating</h3>
        <p className="text-sm text-muted-foreground">
          Prominent elevation with backdrop blur
        </p>
      </Surface>
      <Surface elevation="inset" className="p-6 w-[200px]">
        <h3 className="font-semibold mb-2">Inset</h3>
        <p className="text-sm text-muted-foreground">
          Sunken appearance with inset shadow
        </p>
      </Surface>
    </div>
  ),
};

export const Interactive: Story = {
  render: () => (
    <div className="flex gap-4">
      <Surface elevation="raised" interactive className="p-6 cursor-pointer">
        <h3 className="font-semibold mb-2">Interactive Surface</h3>
        <p className="text-sm text-muted-foreground">
          Hover over me to see the effect
        </p>
      </Surface>
      <Surface elevation="floating" interactive className="p-6 cursor-pointer">
        <h3 className="font-semibold mb-2">Floating Interactive</h3>
        <p className="text-sm text-muted-foreground">
          Click or hover for interaction
        </p>
      </Surface>
    </div>
  ),
};

export const CardExample: Story = {
  render: () => (
    <Surface elevation="raised" className="p-6 w-[350px]">
      <h2 className="text-xl font-bold mb-2">Surface as Card</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Surface can be used as a card container with standardized elevation.
      </p>
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">
          Action
        </button>
        <button className="px-4 py-2 border rounded-md text-sm">Cancel</button>
      </div>
    </Surface>
  ),
};

export const EmptyState: Story = {
  render: () => (
    <Surface elevation="inset" className="p-8 w-[400px] text-center">
      <div className="text-muted-foreground">
        <svg
          className="mx-auto h-12 w-12 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
        <h3 className="font-semibold mb-2">No items found</h3>
        <p className="text-sm">
          This sunken surface works well for empty states
        </p>
      </div>
    </Surface>
  ),
};

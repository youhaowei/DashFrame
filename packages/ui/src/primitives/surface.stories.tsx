import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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
      <Surface elevation="plain" className="w-[200px] p-6">
        <h3 className="mb-2 font-semibold">Plain</h3>
        <p className="text-sm text-muted-foreground">
          Minimal flat surface with border only
        </p>
      </Surface>
      <Surface elevation="raised" className="w-[200px] p-6">
        <h3 className="mb-2 font-semibold">Raised</h3>
        <p className="text-sm text-muted-foreground">
          Standard elevated surface with subtle shadow
        </p>
      </Surface>
      <Surface elevation="floating" className="w-[200px] p-6">
        <h3 className="mb-2 font-semibold">Floating</h3>
        <p className="text-sm text-muted-foreground">
          Prominent elevation with backdrop blur
        </p>
      </Surface>
      <Surface elevation="inset" className="w-[200px] p-6">
        <h3 className="mb-2 font-semibold">Inset</h3>
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
      <Surface elevation="raised" interactive className="cursor-pointer p-6">
        <h3 className="mb-2 font-semibold">Interactive Surface</h3>
        <p className="text-sm text-muted-foreground">
          Hover over me to see the effect
        </p>
      </Surface>
      <Surface elevation="floating" interactive className="cursor-pointer p-6">
        <h3 className="mb-2 font-semibold">Floating Interactive</h3>
        <p className="text-sm text-muted-foreground">
          Click or hover for interaction
        </p>
      </Surface>
    </div>
  ),
};

export const CardExample: Story = {
  render: () => (
    <Surface elevation="raised" className="w-[350px] p-6">
      <h2 className="mb-2 text-xl font-bold">Surface as Card</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Surface can be used as a card container with standardized elevation.
      </p>
      <div className="flex gap-2">
        <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
          Action
        </button>
        <button className="rounded-md border px-4 py-2 text-sm">Cancel</button>
      </div>
    </Surface>
  ),
};

export const EmptyState: Story = {
  render: () => (
    <Surface elevation="inset" className="w-[400px] p-8 text-center">
      <div className="text-muted-foreground">
        <svg
          className="mx-auto mb-4 h-12 w-12"
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
        <h3 className="mb-2 font-semibold">No items found</h3>
        <p className="text-sm">
          This sunken surface works well for empty states
        </p>
      </div>
    </Surface>
  ),
};

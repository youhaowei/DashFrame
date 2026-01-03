import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Stack } from "./Stack";
import { Button } from "../primitives/button";
import { DatabaseIcon, ChartIcon, FileIcon } from "../lib/icons";

const meta = {
  title: "Components/Layout/Stack",
  component: Stack,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    direction: {
      control: "select",
      options: ["vertical", "horizontal"],
      description: "Stack direction",
    },
    spacing: {
      control: "select",
      options: ["none", "xs", "sm", "md", "lg", "xl"],
      description: "Spacing between items",
    },
    align: {
      control: "select",
      options: ["start", "center", "end", "stretch"],
      description: "Alignment along cross axis",
    },
    justify: {
      control: "select",
      options: ["start", "center", "end", "between", "around"],
      description: "Justification along main axis",
    },
    wrap: {
      control: "boolean",
      description: "Whether to wrap items",
    },
  },
} satisfies Meta<typeof Stack>;

export default meta;
type Story = Omit<StoryObj<typeof meta>, "args"> & {
  args?: StoryObj<typeof meta>["args"];
};

/**
 * Default vertical stack with standard spacing
 */
export const Default: Story = {
  args: {
    direction: "vertical",
    spacing: "md",
    children: (
      <>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 1
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 2
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 3
        </div>
      </>
    ),
  },
};

/**
 * Horizontal stack
 */
export const Horizontal: Story = {
  args: {
    direction: "horizontal",
    spacing: "md",
    children: (
      <>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 1
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 2
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 3
        </div>
      </>
    ),
  },
};

/**
 * No spacing
 */
export const NoSpacing: Story = {
  args: {
    direction: "vertical",
    spacing: "none",
    children: (
      <>
        <div className="border-border/60 bg-card border-b p-4">Item 1</div>
        <div className="border-border/60 bg-card border-b p-4">Item 2</div>
        <div className="bg-card p-4">Item 3</div>
      </>
    ),
  },
};

/**
 * Extra small spacing
 */
export const ExtraSmallSpacing: Story = {
  args: {
    direction: "vertical",
    spacing: "xs",
    children: (
      <>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 1
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 2
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 3
        </div>
      </>
    ),
  },
};

/**
 * Small spacing
 */
export const SmallSpacing: Story = {
  args: {
    direction: "vertical",
    spacing: "sm",
    children: (
      <>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 1
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 2
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 3
        </div>
      </>
    ),
  },
};

/**
 * Large spacing
 */
export const LargeSpacing: Story = {
  args: {
    direction: "vertical",
    spacing: "lg",
    children: (
      <>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 1
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 2
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 3
        </div>
      </>
    ),
  },
};

/**
 * Extra large spacing
 */
export const ExtraLargeSpacing: Story = {
  args: {
    direction: "vertical",
    spacing: "xl",
    children: (
      <>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 1
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 2
        </div>
        <div className="border-border/60 bg-card rounded-xl border p-4">
          Item 3
        </div>
      </>
    ),
  },
};

/**
 * Center aligned (horizontal)
 */
export const CenterAligned: Story = {
  args: {
    direction: "horizontal",
    spacing: "sm",
    align: "center",
    children: (
      <>
        <DatabaseIcon className="h-4 w-4" />
        <span className="text-sm">Database icon with text</span>
      </>
    ),
  },
};

/**
 * Center justified (horizontal)
 */
export const CenterJustified: Story = {
  args: {
    direction: "horizontal",
    spacing: "sm",
    justify: "center",
    children: (
      <>
        <Button variant="outlined">Cancel</Button>
        <Button>Save</Button>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="border-border/60 w-full rounded-2xl border p-6">
        <Story />
      </div>
    ),
  ],
};

/**
 * Space between (horizontal)
 */
export const SpaceBetween: Story = {
  args: {
    direction: "horizontal",
    justify: "between",
    align: "center",
    children: (
      <>
        <span className="text-sm font-medium">Total Items</span>
        <span className="text-muted-foreground text-sm">42</span>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="border-border/60 w-full rounded-2xl border p-4">
        <Story />
      </div>
    ),
  ],
};

/**
 * Wrapping horizontal stack
 */
export const WrappingStack: Story = {
  args: {
    direction: "horizontal",
    spacing: "sm",
    wrap: true,
    children: (
      <>
        <Button size="sm">Option 1</Button>
        <Button size="sm" variant="outlined">
          Option 2
        </Button>
        <Button size="sm" variant="outlined">
          Option 3
        </Button>
        <Button size="sm" variant="outlined">
          Option 4
        </Button>
        <Button size="sm" variant="outlined">
          Option 5
        </Button>
        <Button size="sm" variant="outlined">
          Option 6
        </Button>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="border-border/60 w-[300px] rounded-2xl border p-4">
        <Story />
      </div>
    ),
  ],
};

/**
 * Icon and text pattern
 */
export const IconAndText: Story = {
  args: {
    direction: "horizontal",
    spacing: "sm",
    align: "center",
    children: (
      <>
        <DatabaseIcon className="text-primary h-4 w-4" />
        <span className="text-sm font-medium">Sales Database</span>
        <span className="text-muted-foreground text-xs">12 tables</span>
      </>
    ),
  },
};

/**
 * Form layout (vertical)
 */
export const FormLayout: Story = {
  args: {
    direction: "vertical",
    spacing: "md",
    children: (
      <>
        <div>
          <label className="mb-2 block text-sm font-medium">Name</label>
          <input
            type="text"
            className="border-border/60 bg-background w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Enter name"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium">Email</label>
          <input
            type="email"
            className="border-border/60 bg-background w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Enter email"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium">Message</label>
          <textarea
            className="border-border/60 bg-background w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Enter message"
            rows={3}
          />
        </div>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="w-[400px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * Card grid pattern (horizontal wrap)
 */
export const CardGrid: Story = {
  args: {
    direction: "horizontal",
    spacing: "md",
    wrap: true,
    children: (
      <>
        {[DatabaseIcon, ChartIcon, FileIcon].map((Icon, i) => (
          <div
            key={i}
            className="border-border/60 bg-card w-[200px] rounded-2xl border p-6"
          >
            <Icon className="mb-3 h-5 w-5" />
            <h3 className="mb-1 text-sm font-semibold">Feature {i + 1}</h3>
            <p className="text-muted-foreground text-xs">
              Description text here
            </p>
          </div>
        ))}
      </>
    ),
  },
};

/**
 * Stretch alignment
 */
export const StretchAlignment: Story = {
  args: {
    direction: "horizontal",
    spacing: "md",
    align: "stretch",
    children: (
      <>
        <div className="border-border/60 bg-card flex-1 rounded-xl border p-4">
          Flexible item 1
        </div>
        <div className="border-border/60 bg-card flex-1 rounded-xl border p-4">
          Flexible item 2<br />
          with more content
        </div>
        <div className="border-border/60 bg-card flex-1 rounded-xl border p-4">
          Flexible item 3
        </div>
      </>
    ),
  },
};

/**
 * Nested stacks
 */
export const NestedStacks: Story = {
  render: () => (
    <Stack direction="vertical" spacing="lg">
      <div className="border-border/60 bg-card rounded-2xl border p-6">
        <h3 className="mb-4 text-sm font-semibold">Horizontal nested stack</h3>
        <Stack direction="horizontal" spacing="sm">
          <Button size="sm">Button 1</Button>
          <Button size="sm" variant="outlined">
            Button 2
          </Button>
          <Button size="sm" variant="outlined">
            Button 3
          </Button>
        </Stack>
      </div>

      <div className="border-border/60 bg-card rounded-2xl border p-6">
        <h3 className="mb-4 text-sm font-semibold">Vertical nested stack</h3>
        <Stack direction="vertical" spacing="xs">
          <div className="text-sm">Item 1</div>
          <div className="text-sm">Item 2</div>
          <div className="text-sm">Item 3</div>
        </Stack>
      </div>
    </Stack>
  ),
};

/**
 * As semantic nav element
 */
export const SemanticNav: Story = {
  args: {
    as: "nav",
    direction: "horizontal",
    spacing: "md",
    children: (
      <>
        <Button variant="text" size="sm">
          Home
        </Button>
        <Button variant="text" size="sm">
          About
        </Button>
        <Button variant="text" size="sm">
          Contact
        </Button>
      </>
    ),
  },
};

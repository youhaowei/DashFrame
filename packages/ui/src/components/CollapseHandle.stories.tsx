import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CollapseHandle } from "./CollapseHandle";

const meta = {
  title: "Components/Layout/CollapseHandle",
  component: CollapseHandle,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    direction: {
      control: "select",
      options: ["left", "right", "up", "down"],
      description: "Direction the handle points",
    },
    isOpen: {
      control: "boolean",
      description: "Whether the section is open",
    },
  },
} satisfies Meta<typeof CollapseHandle>;

export default meta;
type Story = Omit<StoryObj<typeof meta>, "args"> & {
  args?: StoryObj<typeof meta>["args"];
};

/**
 * Default collapse handle (down direction)
 */
export const Default: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <CollapseHandle
        {...args}
        direction="down"
        isOpen={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      />
    );
  },
};

/**
 * Down direction (bottom of panel)
 */
export const DirectionDown: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <div className="space-y-4">
        <div className="bg-card border-border/60 rounded-2xl border p-6">
          <p className="text-sm">Panel content above</p>
        </div>
        <div className="flex justify-center">
          <CollapseHandle
            {...args}
            direction="down"
            isOpen={isOpen}
            onClick={() => setIsOpen(!isOpen)}
          />
        </div>
        <p className="text-muted-foreground text-center text-xs">
          {isOpen ? "Click to collapse" : "Click to expand"}
        </p>
      </div>
    );
  },
};

/**
 * Up direction (top of panel)
 */
export const DirectionUp: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-center text-xs">
          {isOpen ? "Click to collapse" : "Click to expand"}
        </p>
        <div className="flex justify-center">
          <CollapseHandle
            {...args}
            direction="up"
            isOpen={isOpen}
            onClick={() => setIsOpen(!isOpen)}
          />
        </div>
        <div className="bg-card border-border/60 rounded-2xl border p-6">
          <p className="text-sm">Panel content below</p>
        </div>
      </div>
    );
  },
};

/**
 * Left direction (left side of panel)
 */
export const DirectionLeft: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <div className="flex items-center gap-4">
        <div className="bg-card border-border/60 rounded-2xl border p-6">
          <p className="text-sm">Content on the right</p>
        </div>
        <CollapseHandle
          {...args}
          direction="left"
          isOpen={isOpen}
          onClick={() => setIsOpen(!isOpen)}
        />
        <p className="text-muted-foreground text-xs">
          {isOpen ? "Collapse" : "Expand"}
        </p>
      </div>
    );
  },
};

/**
 * Right direction (right side of panel)
 */
export const DirectionRight: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <div className="flex items-center gap-4">
        <p className="text-muted-foreground text-xs">
          {isOpen ? "Collapse" : "Expand"}
        </p>
        <CollapseHandle
          {...args}
          direction="right"
          isOpen={isOpen}
          onClick={() => setIsOpen(!isOpen)}
        />
        <div className="bg-card border-border/60 rounded-2xl border p-6">
          <p className="text-sm">Content on the left</p>
        </div>
      </div>
    );
  },
};

/**
 * Collapsed state (down)
 */
export const CollapsedDown: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <div className="space-y-4">
        <div className="flex justify-center">
          <CollapseHandle
            {...args}
            direction="down"
            isOpen={isOpen}
            onClick={() => setIsOpen(!isOpen)}
          />
        </div>
        <p className="text-muted-foreground text-center text-xs">
          Collapsed state - click to expand
        </p>
      </div>
    );
  },
};

/**
 * Integrated with panel (bottom)
 */
export const IntegratedBottomPanel: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <div className="w-[400px]">
        <div className="bg-card border-border/60 rounded-t-2xl border p-6">
          <h3 className="mb-2 text-base font-semibold">Panel Header</h3>
          {isOpen && (
            <div className="mt-4 space-y-2">
              <p className="text-sm">Panel content visible when expanded</p>
              <p className="text-muted-foreground text-xs">
                This content is collapsible
              </p>
            </div>
          )}
        </div>
        <div className="-mt-px flex justify-center">
          <CollapseHandle
            {...args}
            direction="down"
            isOpen={isOpen}
            onClick={() => setIsOpen(!isOpen)}
          />
        </div>
      </div>
    );
  },
};

/**
 * Integrated with sidebar (right)
 */
export const IntegratedSidebar: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <div className="flex h-[300px] items-stretch">
        <div className="bg-muted/20 flex flex-1 items-center justify-center rounded-l-2xl p-6">
          <p className="text-muted-foreground text-sm">Main content area</p>
        </div>
        <div className="-ml-px flex items-center">
          <CollapseHandle
            {...args}
            direction="right"
            isOpen={isOpen}
            onClick={() => setIsOpen(!isOpen)}
          />
        </div>
        {isOpen && (
          <div className="bg-card border-border/60 w-[250px] rounded-r-2xl border border-l-0 p-6">
            <h3 className="mb-4 text-sm font-semibold">Sidebar</h3>
            <p className="text-muted-foreground text-xs">
              Collapsible sidebar content
            </p>
          </div>
        )}
      </div>
    );
  },
};

/**
 * Custom aria-label
 */
export const CustomAriaLabel: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <CollapseHandle
        {...args}
        direction="down"
        isOpen={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        ariaLabel={isOpen ? "Hide advanced settings" : "Show advanced settings"}
      />
    );
  },
};

/**
 * All directions showcase
 */
export const AllDirections: Story = {
  render: () => {
    const [openStates, setOpenStates] = useState({
      up: true,
      down: true,
      left: true,
      right: true,
    });

    return (
      <div className="grid max-w-2xl grid-cols-2 gap-8">
        {/* Down */}
        <div className="space-y-2">
          <p className="text-center text-xs font-medium">Down</p>
          <div className="flex justify-center">
            <CollapseHandle
              direction="down"
              isOpen={openStates.down}
              onClick={() =>
                setOpenStates({ ...openStates, down: !openStates.down })
              }
            />
          </div>
        </div>

        {/* Up */}
        <div className="space-y-2">
          <p className="text-center text-xs font-medium">Up</p>
          <div className="flex justify-center">
            <CollapseHandle
              direction="up"
              isOpen={openStates.up}
              onClick={() =>
                setOpenStates({ ...openStates, up: !openStates.up })
              }
            />
          </div>
        </div>

        {/* Left */}
        <div className="space-y-2">
          <p className="text-center text-xs font-medium">Left</p>
          <div className="flex justify-center">
            <CollapseHandle
              direction="left"
              isOpen={openStates.left}
              onClick={() =>
                setOpenStates({ ...openStates, left: !openStates.left })
              }
            />
          </div>
        </div>

        {/* Right */}
        <div className="space-y-2">
          <p className="text-center text-xs font-medium">Right</p>
          <div className="flex justify-center">
            <CollapseHandle
              direction="right"
              isOpen={openStates.right}
              onClick={() =>
                setOpenStates({ ...openStates, right: !openStates.right })
              }
            />
          </div>
        </div>
      </div>
    );
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { Panel, PanelSection } from "./Panel";
import { Button } from "../primitives/button";
import { Database, Plus, Refresh, Trash2 } from "../lib/icons";

const meta = {
  title: "Components/Layout/Panel",
  component: Panel,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    elevation: {
      control: "select",
      options: ["flat", "raised", "floating"],
      description: "Visual elevation of the panel",
    },
  },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default panel with header, content, and footer
 */
export const Default: Story = {
  args: {
    header: <h2 className="text-base font-semibold">Panel Header</h2>,
    children: (
      <div className="space-y-4">
        <p>This is the scrollable content area.</p>
        <p>Add any content here and it will scroll independently.</p>
      </div>
    ),
    footer: (
      <div className="flex gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Apply</Button>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="h-[400px] w-[400px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * Panel with header only (no footer)
 */
export const HeaderOnly: Story = {
  args: {
    header: (
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Data Sources</h2>
        <Button size="icon" variant="ghost">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    ),
    children: (
      <div className="space-y-4">
        <div className="rounded-xl border border-border/60 p-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            <span className="text-sm font-medium">Sales Database</span>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">PostgreSQL • 12 tables</p>
        </div>
        <div className="rounded-xl border border-border/60 p-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            <span className="text-sm font-medium">Analytics DB</span>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">MongoDB • 8 collections</p>
        </div>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="h-[400px] w-[400px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * Panel with scrollable content to demonstrate scroll behavior
 */
export const ScrollableContent: Story = {
  args: {
    header: <h2 className="text-base font-semibold">Long Content Panel</h2>,
    children: (
      <div className="space-y-4">
        {Array.from({ length: 20 }, (_, i) => (
          <div key={i} className="rounded-xl border border-border/60 p-4">
            <h3 className="text-sm font-medium">Item {i + 1}</h3>
            <p className="text-muted-foreground text-xs">
              This demonstrates scrollable content behavior
            </p>
          </div>
        ))}
      </div>
    ),
    footer: (
      <div className="flex gap-2">
        <Button variant="outline" size="sm">
          <Refresh className="h-4 w-4 mr-2" />
          Refresh
        </Button>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add New
        </Button>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="h-[400px] w-[400px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * Panel with PanelSection dividers for organized content
 */
export const WithSections: Story = {
  args: {
    header: <h2 className="text-base font-semibold">Settings</h2>,
    children: (
      <div className="space-y-0">
        <PanelSection
          title="General"
          description="Basic configuration options"
        >
          <div className="space-y-3 pb-6">
            <div className="flex items-center justify-between">
              <span className="text-sm">Enable notifications</span>
              <Button variant="outline" size="sm">Toggle</Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Auto-save</span>
              <Button variant="outline" size="sm">Toggle</Button>
            </div>
          </div>
        </PanelSection>

        <PanelSection
          title="Advanced"
          description="Advanced settings for power users"
        >
          <div className="space-y-3 pb-6">
            <div className="flex items-center justify-between">
              <span className="text-sm">Debug mode</span>
              <Button variant="outline" size="sm">Toggle</Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Performance monitoring</span>
              <Button variant="outline" size="sm">Toggle</Button>
            </div>
          </div>
        </PanelSection>

        <PanelSection title="Danger Zone">
          <div className="pb-6">
            <Button variant="destructive" size="sm">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Account
            </Button>
          </div>
        </PanelSection>
      </div>
    ),
    footer: (
      <div className="flex gap-2">
        <Button variant="outline">Reset</Button>
        <Button>Save Changes</Button>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="h-[500px] w-[400px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * Floating elevation panel (for modals, popovers)
 */
export const FloatingElevation: Story = {
  args: {
    elevation: "floating",
    header: <h2 className="text-base font-semibold">Overlay Panel</h2>,
    children: (
      <div className="space-y-4">
        <p className="text-sm">This panel floats above other content with elevated shadow.</p>
        <p className="text-muted-foreground text-xs">
          Use floating elevation for panels that overlay other elements.
        </p>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="h-[300px] w-[400px] bg-muted/20 flex items-center justify-center">
        <Story />
      </div>
    ),
  ],
};

/**
 * Data source control panel with realistic content
 */
export const DataSourceControls: Story = {
  args: {
    header: (
      <div>
        <h2 className="text-base font-semibold">Data Source Controls</h2>
        <p className="text-muted-foreground text-xs mt-1">
          Configure your database connection
        </p>
      </div>
    ),
    children: (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium block mb-2">Connection Type</label>
          <Button variant="outline" className="w-full justify-start">
            <Database className="h-4 w-4 mr-2" />
            PostgreSQL
          </Button>
        </div>
        <div>
          <label className="text-sm font-medium block mb-2">Host</label>
          <input
            type="text"
            className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            placeholder="localhost:5432"
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-2">Database Name</label>
          <input
            type="text"
            className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            placeholder="sales_db"
          />
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">
            <strong>Status:</strong> Connected
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            <strong>Tables:</strong> 12 discovered
          </p>
        </div>
      </div>
    ),
    footer: (
      <div className="flex gap-2">
        <Button variant="outline" size="sm">
          <Refresh className="h-4 w-4 mr-2" />
          Test Connection
        </Button>
        <Button size="sm">Save</Button>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="h-[600px] w-[400px]">
        <Story />
      </div>
    ),
  ],
};

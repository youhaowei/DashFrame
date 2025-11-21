import type { Meta, StoryObj } from "@storybook/react";
import { CollapsibleSection } from "./CollapsibleSection";
import { ItemSelector, type SelectableItem } from "./ItemSelector";
import { Panel } from "./Panel";
import { Button } from "../primitives/button";
import { Database, Plus } from "../lib/icons";
import { useState } from "react";

const meta = {
  title: "Components/Layout/CollapsibleSection",
  component: CollapsibleSection,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    defaultOpen: {
      control: "boolean",
      description: "Whether the section starts expanded",
    },
  },
} satisfies Meta<typeof CollapsibleSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default collapsible section (starts open)
 */
export const Default: Story = {
  args: {
    defaultOpen: true,
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h3 className="text-base font-semibold mb-4">Content Section</h3>
        <p className="text-sm">
          This content can be collapsed and expanded using the chevron button below.
        </p>
      </div>
    ),
  },
};

/**
 * Starts collapsed
 */
export const StartsClosed: Story = {
  args: {
    defaultOpen: false,
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h3 className="text-base font-semibold mb-4">Hidden Content</h3>
        <p className="text-sm">
          This section starts collapsed. Click the chevron to expand.
        </p>
      </div>
    ),
  },
};

/**
 * With ItemSelector component
 */
export const WithItemSelector: Story = {
  render: (args) => {
    const [items, setItems] = useState<SelectableItem[]>([
      {
        id: "1",
        label: "Sales Database",
        active: true,
        badge: "PostgreSQL",
        metadata: "12 tables",
        icon: Database,
      },
      {
        id: "2",
        label: "Analytics DB",
        active: false,
        badge: "MongoDB",
        metadata: "8 collections",
        icon: Database,
      },
    ]);

    return (
      <CollapsibleSection {...args}>
        <ItemSelector
          title="Data Sources"
          description="Select a data source to view details"
          items={items}
          onItemSelect={(id) => {
            setItems(items.map((item) => ({ ...item, active: item.id === id })));
          }}
          actions={[
            {
              label: "New",
              onClick: () => alert("New"),
              icon: Plus,
            },
          ]}
        />
      </CollapsibleSection>
    );
  },
  args: {
    defaultOpen: true,
  },
};

/**
 * With rich content
 */
export const WithRichContent: Story = {
  args: {
    defaultOpen: true,
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold mb-2">Section Title</h3>
          <p className="text-muted-foreground text-sm">
            This section contains rich content with multiple elements.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-border/60 p-4">
            <Database className="h-5 w-5 mb-2" />
            <p className="text-sm font-medium">PostgreSQL</p>
            <p className="text-muted-foreground text-xs">12 tables</p>
          </div>
          <div className="rounded-xl border border-border/60 p-4">
            <Database className="h-5 w-5 mb-2" />
            <p className="text-sm font-medium">MongoDB</p>
            <p className="text-muted-foreground text-xs">8 collections</p>
          </div>
        </div>
        <Button className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          Add Data Source
        </Button>
      </div>
    ),
  },
};

/**
 * Nested collapsible sections
 */
export const NestedSections: Story = {
  render: () => (
    <div className="space-y-4">
      <CollapsibleSection defaultOpen={true}>
        <div className="bg-card rounded-2xl border border-border/60 p-6">
          <h3 className="text-base font-semibold mb-4">Parent Section</h3>
          <p className="text-sm mb-4">This is the outer collapsible section.</p>

          <CollapsibleSection defaultOpen={false}>
            <div className="bg-muted/50 rounded-xl border border-border/60 p-4">
              <h4 className="text-sm font-semibold mb-2">Nested Section</h4>
              <p className="text-xs text-muted-foreground">
                This is a nested collapsible section inside the parent.
              </p>
            </div>
          </CollapsibleSection>
        </div>
      </CollapsibleSection>
    </div>
  ),
};

/**
 * In a settings panel context
 */
export const SettingsPanel: Story = {
  render: () => (
    <Panel
      header={<h2 className="text-base font-semibold">Settings</h2>}
      className="w-[400px]"
    >
      <div className="space-y-4 -m-6">
        <CollapsibleSection defaultOpen={true}>
          <div className="bg-card border-b border-border/60 p-6">
            <h3 className="text-sm font-semibold mb-4">General Settings</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Enable notifications</span>
                <Button variant="outline" size="sm">Toggle</Button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Auto-save</span>
                <Button variant="outline" size="sm">Toggle</Button>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection defaultOpen={false}>
          <div className="bg-card border-b border-border/60 p-6">
            <h3 className="text-sm font-semibold mb-4">Advanced Settings</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Debug mode</span>
                <Button variant="outline" size="sm">Toggle</Button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Performance monitoring</span>
                <Button variant="outline" size="sm">Toggle</Button>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </Panel>
  ),
  decorators: [
    (Story) => (
      <div className="h-[500px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * With long scrollable content
 */
export const LongContent: Story = {
  args: {
    defaultOpen: true,
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6 space-y-4">
        <h3 className="text-base font-semibold">Long Content Section</h3>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="rounded-xl border border-border/60 p-4">
            <h4 className="text-sm font-medium">Item {i + 1}</h4>
            <p className="text-muted-foreground text-xs">
              This is a content item in a collapsible section
            </p>
          </div>
        ))}
      </div>
    ),
  },
};

/**
 * Minimal content
 */
export const MinimalContent: Story = {
  args: {
    defaultOpen: true,
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <p className="text-sm">Simple collapsible content</p>
      </div>
    ),
  },
};

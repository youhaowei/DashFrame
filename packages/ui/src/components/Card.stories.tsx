import type { Meta, StoryObj } from "@storybook/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "./Card";
import { Button } from "../primitives/button";
import { Database, BarChart3, Plus, Trash2 } from "../lib/icons";

const meta = {
  title: "Components/Layout/Card",
  component: Card,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    elevation: {
      control: "select",
      options: ["flat", "raised", "floating"],
      description: "Visual elevation of the card",
    },
    interactive: {
      control: "boolean",
      description: "Adds hover states for clickable cards",
    },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default card with all sections
 */
export const Default: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
          <CardDescription>
            This is a description of the card content
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p>Card content goes here. This is the main area for your content.</p>
        </CardContent>
        <CardFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Save</Button>
        </CardFooter>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/**
 * Card with header action button
 */
export const WithHeaderAction: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Data Source Settings</CardTitle>
          <CardDescription>Configure your database connection</CardDescription>
          <CardAction>
            <Button size="sm" variant="outline">
              Edit
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">Database Type</p>
              <p className="text-muted-foreground text-sm">PostgreSQL</p>
            </div>
            <div>
              <p className="text-sm font-medium">Host</p>
              <p className="text-muted-foreground text-sm">localhost:5432</p>
            </div>
          </div>
        </CardContent>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/**
 * Simple card (content only)
 */
export const SimpleContent: Story = {
  args: {
    children: (
      <CardContent>
        <p>This is a simple card with just content, no header or footer.</p>
      </CardContent>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/**
 * Card with floating elevation
 */
export const FloatingElevation: Story = {
  args: {
    elevation: "floating",
    children: (
      <>
        <CardHeader>
          <CardTitle>Elevated Card</CardTitle>
          <CardDescription>This card floats above other content</CardDescription>
        </CardHeader>
        <CardContent>
          <p>Use floating elevation for modals, popovers, or overlays.</p>
        </CardContent>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/**
 * Interactive card (hoverable)
 */
export const Interactive: Story = {
  args: {
    interactive: true,
    children: (
      <>
        <CardHeader>
          <CardTitle>Clickable Card</CardTitle>
          <CardDescription>This card has hover states</CardDescription>
        </CardHeader>
        <CardContent>
          <p>Hover over this card to see the interactive effect.</p>
        </CardContent>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/**
 * Data source card (DashFrame specific)
 */
export const DataSourceCard: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <CardTitle>Sales Database</CardTitle>
          </div>
          <CardDescription>PostgreSQL production database</CardDescription>
          <CardAction>
            <Button size="icon" variant="ghost">
              <Trash2 className="h-4 w-4" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tables</span>
              <span className="font-medium">12</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <span className="text-green-600">Connected</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Last sync</span>
              <span className="font-medium">5 min ago</span>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" className="w-full">
            View Tables
          </Button>
        </CardFooter>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/**
 * Visualization card (DashFrame specific)
 */
export const VisualizationCard: Story = {
  args: {
    interactive: true,
    children: (
      <>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            <CardTitle>Sales by Region</CardTitle>
          </div>
          <CardDescription>Bar chart • 1,250 rows</CardDescription>
          <CardAction>
            <Button size="sm" variant="outline">
              Edit
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="bg-muted rounded-xl h-32 flex items-center justify-center">
            <span className="text-muted-foreground text-sm">Chart Preview</span>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" size="sm">View Full</Button>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Duplicate
          </Button>
        </CardFooter>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/**
 * Empty state card (inset elevation)
 */
export const EmptyStateCard: Story = {
  args: {
    elevation: "inset",
    children: (
      <CardContent className="text-center py-12">
        <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="font-medium mb-2">No data sources</h3>
        <p className="text-muted-foreground text-sm mb-4">
          Get started by adding your first data source
        </p>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Data Source
        </Button>
      </CardContent>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/**
 * Stats card
 */
export const StatsCard: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Total Revenue</CardTitle>
          <CardDescription>Last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">$45,231.89</div>
          <p className="text-muted-foreground text-sm mt-2">
            +20.1% from last month
          </p>
        </CardContent>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
};

/**
 * Card without header
 */
export const WithoutHeader: Story = {
  args: {
    children: (
      <>
        <CardContent>
          <h3 className="font-semibold mb-2">Custom Content Header</h3>
          <p className="text-sm">
            This card doesn't use CardHeader but has content directly.
          </p>
        </CardContent>
        <CardFooter>
          <Button>Action</Button>
        </CardFooter>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/**
 * Multiple cards in a grid
 */
export const MultipleCards: Story = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Data Sources</CardTitle>
          <CardDescription>3 connected</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">3</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Insights</CardTitle>
          <CardDescription>5 active</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">5</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Visualizations</CardTitle>
          <CardDescription>12 created</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">12</div>
        </CardContent>
      </Card>
      <Card interactive>
        <CardHeader>
          <CardTitle>Create New</CardTitle>
          <CardDescription>Get started</CardDescription>
        </CardHeader>
        <CardContent>
          <Plus className="h-12 w-12 text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  ),
};

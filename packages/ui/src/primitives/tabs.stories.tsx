import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const meta = {
  title: "Primitives/Layout/Tabs",
  component: Tabs,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="tab1" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        <TabsTrigger value="tab3">Tab 3</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-semibold">Content for Tab 1</h3>
          <p className="text-muted-foreground text-sm">
            This is the content that appears when Tab 1 is selected.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="tab2">
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-semibold">Content for Tab 2</h3>
          <p className="text-muted-foreground text-sm">
            This is the content that appears when Tab 2 is selected.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="tab3">
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-semibold">Content for Tab 3</h3>
          <p className="text-muted-foreground text-sm">
            This is the content that appears when Tab 3 is selected.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  ),
};

export const AccountSettings: Story = {
  render: () => (
    <Tabs defaultValue="general" className="w-[500px]">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>
      <TabsContent value="general">
        <div className="rounded-md border p-6">
          <h3 className="mb-4 text-lg font-semibold">General Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Username</label>
              <p className="text-muted-foreground text-sm">john_doe</p>
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <p className="text-muted-foreground text-sm">john@example.com</p>
            </div>
            <div>
              <label className="text-sm font-medium">Bio</label>
              <p className="text-muted-foreground text-sm">
                Software developer passionate about building great products.
              </p>
            </div>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="security">
        <div className="rounded-md border p-6">
          <h3 className="mb-4 text-lg font-semibold">Security Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                Two-factor authentication
              </label>
              <p className="text-muted-foreground text-sm">
                Enabled via authenticator app
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Password</label>
              <p className="text-muted-foreground text-sm">
                Last changed 30 days ago
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Active sessions</label>
              <p className="text-muted-foreground text-sm">3 active devices</p>
            </div>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="notifications">
        <div className="rounded-md border p-6">
          <h3 className="mb-4 text-lg font-semibold">
            Notification Preferences
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Email notifications</label>
              <p className="text-muted-foreground text-sm">Enabled</p>
            </div>
            <div>
              <label className="text-sm font-medium">Push notifications</label>
              <p className="text-muted-foreground text-sm">Disabled</p>
            </div>
            <div>
              <label className="text-sm font-medium">Weekly digest</label>
              <p className="text-muted-foreground text-sm">Enabled</p>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[450px]">
      <TabsList>
        <TabsTrigger value="overview">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          Overview
        </TabsTrigger>
        <TabsTrigger value="analytics">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          Analytics
        </TabsTrigger>
        <TabsTrigger value="reports">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Reports
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <div className="rounded-md border p-6">
          <p className="text-muted-foreground text-sm">
            Welcome to your dashboard overview. Here you can see a summary of
            your key metrics and activities.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="analytics">
        <div className="rounded-md border p-6">
          <p className="text-muted-foreground text-sm">
            View detailed analytics and performance metrics for your account.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="reports">
        <div className="rounded-md border p-6">
          <p className="text-muted-foreground text-sm">
            Generate and download comprehensive reports for your data.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  ),
};

export const DisabledTab: Story = {
  render: () => (
    <Tabs defaultValue="active" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="active">Active</TabsTrigger>
        <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
        <TabsTrigger value="archived" disabled>
          Archived
        </TabsTrigger>
      </TabsList>
      <TabsContent value="active">
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-semibold">Active Items</h3>
          <p className="text-muted-foreground text-sm">
            View all currently active items.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="upcoming">
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-semibold">Upcoming Items</h3>
          <p className="text-muted-foreground text-sm">
            View items scheduled for the future.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="archived">
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-semibold">Archived Items</h3>
          <p className="text-muted-foreground text-sm">
            This tab is disabled and cannot be accessed.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  ),
};

export const FullWidth: Story = {
  render: () => (
    <Tabs defaultValue="all" className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="all" className="flex-1">
          All
        </TabsTrigger>
        <TabsTrigger value="pending" className="flex-1">
          Pending
        </TabsTrigger>
        <TabsTrigger value="completed" className="flex-1">
          Completed
        </TabsTrigger>
        <TabsTrigger value="cancelled" className="flex-1">
          Cancelled
        </TabsTrigger>
      </TabsList>
      <TabsContent value="all">
        <div className="rounded-md border p-4">
          <p className="text-muted-foreground text-sm">
            Showing all tasks regardless of status.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="pending">
        <div className="rounded-md border p-4">
          <p className="text-muted-foreground text-sm">
            Showing tasks that are pending completion.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="completed">
        <div className="rounded-md border p-4">
          <p className="text-muted-foreground text-sm">
            Showing all completed tasks.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="cancelled">
        <div className="rounded-md border p-4">
          <p className="text-muted-foreground text-sm">
            Showing cancelled tasks.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  ),
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Switch } from "./switch";
import { Label } from "./label";

const meta = {
  title: "Primitives/Forms/Switch",
  component: Switch,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    checked: {
      control: "boolean",
    },
    disabled: {
      control: "boolean",
    },
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const Checked: Story = {
  args: {
    checked: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const DisabledChecked: Story = {
  args: {
    checked: true,
    disabled: true,
  },
};

export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="airplane-mode" />
      <Label htmlFor="airplane-mode">Airplane mode</Label>
    </div>
  ),
};

export const SettingsExample: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Switch id="notifications" defaultChecked />
          <Label htmlFor="notifications">Push notifications</Label>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Switch id="dark-mode" />
          <Label htmlFor="dark-mode">Dark mode</Label>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Switch id="auto-save" defaultChecked />
          <Label htmlFor="auto-save">Auto-save</Label>
        </div>
      </div>
    </div>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Switch id="analytics" className="mt-1" />
        <div className="grid gap-1.5">
          <Label htmlFor="analytics">Analytics tracking</Label>
          <p className="text-sm text-muted-foreground">
            Share anonymous usage data to help improve the product
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Switch id="marketing" className="mt-1" defaultChecked />
        <div className="grid gap-1.5">
          <Label htmlFor="marketing">Marketing emails</Label>
          <p className="text-sm text-muted-foreground">
            Receive updates about new features and product announcements
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Switch id="security" className="mt-1" defaultChecked disabled />
        <div className="grid gap-1.5">
          <Label htmlFor="security">Security alerts</Label>
          <p className="text-sm text-muted-foreground">
            Required: Cannot be disabled for security reasons
          </p>
        </div>
      </div>
    </div>
  ),
};

export const MultipleStates: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Switch id="off" />
        <Label htmlFor="off">Off (Unchecked)</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="on" checked />
        <Label htmlFor="on">On (Checked)</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="disabled-off" disabled />
        <Label htmlFor="disabled-off">Disabled (Off)</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="disabled-on" checked disabled />
        <Label htmlFor="disabled-on">Disabled (On)</Label>
      </div>
    </div>
  ),
};

export const PrivacySettings: Story = {
  render: () => (
    <div className="w-[400px] space-y-6">
      <div>
        <h3 className="mb-4 text-lg font-semibold">Privacy settings</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Label htmlFor="profile-visibility">Make profile public</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Allow others to see your profile information
              </p>
            </div>
            <Switch id="profile-visibility" />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Label htmlFor="activity-status">Show activity status</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Let others see when you're online
              </p>
            </div>
            <Switch id="activity-status" defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Label htmlFor="search-indexing">Search engine indexing</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Allow search engines to index your profile
              </p>
            </div>
            <Switch id="search-indexing" />
          </div>
        </div>
      </div>
    </div>
  ),
};

export const FeatureToggles: Story = {
  render: () => (
    <div className="w-[450px] space-y-4">
      <h3 className="mb-4 text-lg font-semibold">Feature toggles</h3>
      <div className="space-y-3 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="beta-features">Beta features</Label>
          <Switch id="beta-features" />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="experimental">Experimental mode</Label>
          <Switch id="experimental" />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="developer-mode">Developer mode</Label>
          <Switch id="developer-mode" defaultChecked />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="debug-logging">Debug logging</Label>
          <Switch id="debug-logging" />
        </div>
      </div>
    </div>
  ),
};

export const AccessibilitySettings: Story = {
  render: () => (
    <div className="w-[400px] space-y-6">
      <div>
        <h3 className="mb-4 text-lg font-semibold">Accessibility</h3>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Switch id="high-contrast" className="mt-1" />
            <div className="grid gap-1.5">
              <Label htmlFor="high-contrast">High contrast mode</Label>
              <p className="text-sm text-muted-foreground">
                Increase contrast for better readability
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Switch id="reduce-motion" className="mt-1" />
            <div className="grid gap-1.5">
              <Label htmlFor="reduce-motion">Reduce motion</Label>
              <p className="text-sm text-muted-foreground">
                Minimize animations and transitions
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Switch id="screen-reader" className="mt-1" defaultChecked />
            <div className="grid gap-1.5">
              <Label htmlFor="screen-reader">Screen reader optimization</Label>
              <p className="text-sm text-muted-foreground">
                Enhance experience for assistive technologies
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};

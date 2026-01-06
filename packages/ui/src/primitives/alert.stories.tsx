import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  InfoIcon,
  TerminalIcon,
} from "../lib/icons";
import { Alert, AlertDescription, AlertTitle } from "./alert";

const meta = {
  title: "Primitives/Feedback/Alert",
  component: Alert,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "destructive"],
    },
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Alert className="w-96">
      <TerminalIcon className="h-4 w-4" />
      <AlertTitle>Heads up!</AlertTitle>
      <AlertDescription>
        You can add components to your app using the cli.
      </AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive" className="w-96">
      <AlertCircleIcon className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        Your session has expired. Please log in again.
      </AlertDescription>
    </Alert>
  ),
};

export const WithoutIcon: Story = {
  render: () => (
    <Alert className="w-96">
      <AlertTitle>Update available</AlertTitle>
      <AlertDescription>
        A new software update is available. Download it now to get the latest
        features.
      </AlertDescription>
    </Alert>
  ),
};

export const InfoStyle: Story = {
  render: () => (
    <Alert className="w-96">
      <InfoIcon className="h-4 w-4" />
      <AlertTitle>Information</AlertTitle>
      <AlertDescription>
        Your data source has been successfully connected and is ready to use.
      </AlertDescription>
    </Alert>
  ),
};

export const SuccessStyle: Story = {
  render: () => (
    <Alert className="w-96">
      <CheckCircleIcon className="h-4 w-4 text-green-500" />
      <AlertTitle>Success</AlertTitle>
      <AlertDescription>
        Your visualization has been created and saved to your dashboard.
      </AlertDescription>
    </Alert>
  ),
};

export const TitleOnly: Story = {
  render: () => (
    <Alert className="w-96">
      <AlertCircleIcon className="h-4 w-4" />
      <AlertTitle>Connection lost</AlertTitle>
    </Alert>
  ),
};

export const DescriptionOnly: Story = {
  render: () => (
    <Alert className="w-96">
      <TerminalIcon className="h-4 w-4" />
      <AlertDescription>
        Run `bun install` to install all dependencies.
      </AlertDescription>
    </Alert>
  ),
};

export const MultipleAlerts: Story = {
  render: () => (
    <div className="w-96 space-y-4">
      <Alert>
        <CheckCircleIcon className="h-4 w-4 text-green-500" />
        <AlertTitle>Success</AlertTitle>
        <AlertDescription>
          Your changes have been saved successfully.
        </AlertDescription>
      </Alert>
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertTitle>Info</AlertTitle>
        <AlertDescription>
          3 new data sources are available for connection.
        </AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertCircleIcon className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Failed to load data. Please try again.
        </AlertDescription>
      </Alert>
    </div>
  ),
};

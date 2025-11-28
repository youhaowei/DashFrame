import type { Meta, StoryObj } from "@storybook/react";
import { Toaster } from "./sonner";
import { toast } from "sonner";
import { Button } from "./button";

const meta = {
  title: "Primitives/Notifications/Toast",
  component: Toaster,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <>
      <Toaster />
      <Button onClick={() => toast("Event has been created")}>
        Show toast
      </Button>
    </>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast("Event has been created", {
            description: "Sunday, December 03, 2023 at 9:00 AM",
          })
        }
      >
        Show toast
      </Button>
    </>
  ),
};

export const Success: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast.success("Successfully saved", {
            description: "Your changes have been saved to the database.",
          })
        }
      >
        Show success
      </Button>
    </>
  ),
};

export const ErrorToast: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast.error("Error occurred", {
            description:
              "Failed to connect to the data source. Please try again.",
          })
        }
      >
        Show error
      </Button>
    </>
  ),
};

export const Warning: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast.warning("Warning", {
            description: "Your session will expire in 5 minutes.",
          })
        }
      >
        Show warning
      </Button>
    </>
  ),
};

export const Info: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast.info("Information", {
            description: "A new update is available for download.",
          })
        }
      >
        Show info
      </Button>
    </>
  ),
};

export const Loading: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() => {
          const promise = new Promise((resolve) => setTimeout(resolve, 3000));
          toast.promise(promise, {
            loading: "Loading...",
            success: "Data loaded successfully",
            error: "Failed to load data",
          });
        }}
      >
        Show loading
      </Button>
    </>
  ),
};

export const WithAction: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast("Event has been created", {
            action: {
              label: "Undo",
              onClick: () => toast("Undo clicked"),
            },
          })
        }
      >
        Show toast with action
      </Button>
    </>
  ),
};

export const WithCancel: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast("Are you sure?", {
            description: "This action cannot be undone.",
            cancel: {
              label: "Cancel",
              onClick: () => toast("Cancelled"),
            },
            action: {
              label: "Confirm",
              onClick: () => toast.success("Confirmed"),
            },
          })
        }
      >
        Show confirmation
      </Button>
    </>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <>
      <Toaster />
      <div className="flex flex-col gap-2">
        <Button onClick={() => toast("Default toast message")}>Default</Button>
        <Button
          onClick={() => toast.success("Operation completed successfully")}
        >
          Success
        </Button>
        <Button onClick={() => toast.error("An error occurred")}>Error</Button>
        <Button onClick={() => toast.warning("Warning message")}>
          Warning
        </Button>
        <Button onClick={() => toast.info("Informational message")}>
          Info
        </Button>
        <Button
          onClick={() =>
            toast("With action", {
              action: { label: "Action", onClick: () => {} },
            })
          }
        >
          With action
        </Button>
      </div>
    </>
  ),
};

export const CustomDuration: Story = {
  render: () => (
    <>
      <Toaster />
      <div className="flex flex-col gap-2">
        <Button onClick={() => toast("Quick message", { duration: 1000 })}>
          1 second
        </Button>
        <Button onClick={() => toast("Normal message", { duration: 3000 })}>
          3 seconds
        </Button>
        <Button onClick={() => toast("Long message", { duration: 10000 })}>
          10 seconds
        </Button>
        <Button onClick={() => toast("Infinite", { duration: Infinity })}>
          Stays until dismissed
        </Button>
      </div>
    </>
  ),
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Toaster } from "./sonner";
import { toast } from "sonner";
import { Button } from "../components/button";

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
      <Button
        label="Show toast"
        onClick={() => toast("Event has been created")}
      />
    </>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        label="Show toast"
        onClick={() =>
          toast("Event has been created", {
            description: "Sunday, December 03, 2023 at 9:00 AM",
          })
        }
      />
    </>
  ),
};

export const Success: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        label="Show success"
        onClick={() =>
          toast.success("Successfully saved", {
            description: "Your changes have been saved to the database.",
          })
        }
      />
    </>
  ),
};

export const ErrorToast: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        label="Show error"
        onClick={() =>
          toast.error("Error occurred", {
            description:
              "Failed to connect to the data source. Please try again.",
          })
        }
      />
    </>
  ),
};

export const Warning: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        label="Show warning"
        onClick={() =>
          toast.warning("Warning", {
            description: "Your session will expire in 5 minutes.",
          })
        }
      />
    </>
  ),
};

export const Info: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        label="Show info"
        onClick={() =>
          toast.info("Information", {
            description: "A new update is available for download.",
          })
        }
      />
    </>
  ),
};

export const Loading: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        label="Show loading"
        onClick={() => {
          const promise = new Promise((resolve) => setTimeout(resolve, 3000));
          toast.promise(promise, {
            loading: "Loading...",
            success: "Data loaded successfully",
            error: "Failed to load data",
          });
        }}
      />
    </>
  ),
};

export const WithAction: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        label="Show toast with action"
        onClick={() =>
          toast("Event has been created", {
            action: {
              label: "Undo",
              onClick: () => toast("Undo clicked"),
            },
          })
        }
      />
    </>
  ),
};

export const WithCancel: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        label="Show confirmation"
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
      />
    </>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <>
      <Toaster />
      <div className="flex flex-col gap-2">
        <Button
          label="Default"
          onClick={() => toast("Default toast message")}
        />
        <Button
          label="Success"
          onClick={() => toast.success("Operation completed successfully")}
        />
        <Button
          label="Error"
          onClick={() => toast.error("An error occurred")}
        />
        <Button
          label="Warning"
          onClick={() => toast.warning("Warning message")}
        />
        <Button
          label="Info"
          onClick={() => toast.info("Informational message")}
        />
        <Button
          label="With action"
          onClick={() =>
            toast("With action", {
              action: { label: "Action", onClick: () => {} },
            })
          }
        />
      </div>
    </>
  ),
};

export const CustomDuration: Story = {
  render: () => (
    <>
      <Toaster />
      <div className="flex flex-col gap-2">
        <Button
          label="1 second"
          onClick={() => toast("Quick message", { duration: 1000 })}
        />
        <Button
          label="3 seconds"
          onClick={() => toast("Normal message", { duration: 3000 })}
        />
        <Button
          label="10 seconds"
          onClick={() => toast("Long message", { duration: 10000 })}
        />
        <Button
          label="Stays until dismissed"
          onClick={() => toast("Infinite", { duration: Infinity })}
        />
      </div>
    </>
  ),
};

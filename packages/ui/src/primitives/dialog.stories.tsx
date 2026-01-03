import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { Button } from "../components/button";
import { Input } from "./input";
import { Label } from "./label";

const meta = {
  title: "Primitives/Layout/Dialog",
  component: Dialog,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button label="Open dialog" variant="outlined" asChild />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>
            This is a basic dialog with a title and description.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Dialog content goes here. You can add any components or text you
            need.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button label="Open dialog with footer" asChild />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm action</DialogTitle>
          <DialogDescription>
            Are you sure you want to proceed with this action?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button label="Cancel" variant="outlined" />
          <Button label="Confirm" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const FormDialog: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button label="Edit profile" asChild />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Make changes to your profile here. Click save when you're done.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" defaultValue="John Doe" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" defaultValue="john@example.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bio">Bio</Label>
            <textarea
              id="bio"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Tell us about yourself"
              defaultValue="I'm a software developer"
            />
          </div>
        </div>
        <DialogFooter>
          <Button label="Cancel" variant="outlined" />
          <Button label="Save changes" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const DestructiveDialog: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button label="Delete account" color="danger" asChild />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you absolutely sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete your
            account and remove your data from our servers.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button label="Cancel" variant="outlined" />
          <Button label="Yes, delete account" color="danger" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const WithoutCloseButton: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button label="Open (no close button)" variant="outlined" asChild />
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>No close button</DialogTitle>
          <DialogDescription>
            This dialog doesn't have a close button in the corner. You must use
            the footer buttons.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button label="Cancel" variant="outlined" />
          <Button label="Continue" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

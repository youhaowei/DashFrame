import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldSeparator,
} from "./field";
import { Input } from "./input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

const meta = {
  title: "Primitives/Forms/Field",
  component: Field,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    orientation: {
      control: "select",
      options: ["vertical", "horizontal", "responsive"],
    },
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Field className="w-80">
      <FieldLabel htmlFor="default-field">Email</FieldLabel>
      <Input id="default-field" type="email" placeholder="you@example.com" />
      <FieldDescription>We'll never share your email.</FieldDescription>
    </Field>
  ),
};

export const WithError: Story = {
  render: () => (
    <Field className="w-80" data-invalid="true">
      <FieldLabel htmlFor="error-field">Email</FieldLabel>
      <Input
        id="error-field"
        type="email"
        placeholder="you@example.com"
        aria-invalid="true"
      />
      <FieldError errors={[{ message: "Email address is required" }]} />
    </Field>
  ),
};

export const WithMultipleErrors: Story = {
  render: () => (
    <Field className="w-80" data-invalid="true">
      <FieldLabel htmlFor="multi-error-field">Password</FieldLabel>
      <Input
        id="multi-error-field"
        type="password"
        placeholder="••••••••"
        aria-invalid="true"
      />
      <FieldError
        errors={[
          { message: "Password must be at least 8 characters" },
          { message: "Password must contain a number" },
          { message: "Password must contain a special character" },
        ]}
      />
    </Field>
  ),
};

export const WithSelect: Story = {
  render: () => (
    <Field className="w-80">
      <FieldLabel htmlFor="select-field">Country</FieldLabel>
      <Select>
        <SelectTrigger id="select-field">
          <SelectValue placeholder="Select a country" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="us">United States</SelectItem>
          <SelectItem value="uk">United Kingdom</SelectItem>
          <SelectItem value="ca">Canada</SelectItem>
          <SelectItem value="au">Australia</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>Choose your country of residence.</FieldDescription>
    </Field>
  ),
};

export const HorizontalOrientation: Story = {
  render: () => (
    <Field orientation="horizontal" className="w-96">
      <FieldLabel htmlFor="horizontal-field">Name</FieldLabel>
      <Input id="horizontal-field" type="text" placeholder="John Doe" />
    </Field>
  ),
};

export const FieldGroupWithSeparator: Story = {
  render: () => (
    <FieldGroup className="w-80">
      <Field>
        <FieldLabel htmlFor="first-name">First name</FieldLabel>
        <Input id="first-name" type="text" placeholder="John" />
      </Field>
      <Field>
        <FieldLabel htmlFor="last-name">Last name</FieldLabel>
        <Input id="last-name" type="text" placeholder="Doe" />
      </Field>

      <FieldSeparator>Contact information</FieldSeparator>

      <Field>
        <FieldLabel htmlFor="email-group">Email</FieldLabel>
        <Input id="email-group" type="email" placeholder="john@example.com" />
      </Field>
      <Field>
        <FieldLabel htmlFor="phone">Phone</FieldLabel>
        <Input id="phone" type="tel" placeholder="+1 (555) 123-4567" />
      </Field>
    </FieldGroup>
  ),
};

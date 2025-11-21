import type { Meta, StoryObj } from "@storybook/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { Button } from "./button";
import { ChevronDown } from "../lib/icons";
import { useState } from "react";

const meta = {
  title: "Primitives/Layout/Collapsible",
  component: Collapsible,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Collapsible className="w-80">
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          Show more details
          <ChevronDown className="h-4 w-4" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 rounded-md border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          This is additional content that can be shown or hidden.
        </p>
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <div className="w-80">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              {isOpen ? "Hide" : "Show"} settings
              <ChevronDown
                className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            <div className="rounded-md border bg-card p-3">
              <p className="text-sm font-medium">Setting 1</p>
              <p className="text-xs text-muted-foreground">Description for setting 1</p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="text-sm font-medium">Setting 2</p>
              <p className="text-xs text-muted-foreground">Description for setting 2</p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="text-sm font-medium">Setting 3</p>
              <p className="text-xs text-muted-foreground">Description for setting 3</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  },
};

export const FAQStyle: Story = {
  render: () => {
    const [openItem, setOpenItem] = useState<string | null>(null);
    const faqs = [
      {
        id: "1",
        question: "What is DashFrame?",
        answer: "DashFrame is a data visualization platform that helps you create beautiful dashboards and insights.",
      },
      {
        id: "2",
        question: "How do I get started?",
        answer: "Connect your data source, create a DataFrame, and start building visualizations with our intuitive interface.",
      },
      {
        id: "3",
        question: "What data sources are supported?",
        answer: "We support CSV files, Notion databases, and many other popular data sources.",
      },
    ];

    return (
      <div className="w-96 space-y-2">
        {faqs.map((faq) => (
          <Collapsible
            key={faq.id}
            open={openItem === faq.id}
            onOpenChange={(open) => setOpenItem(open ? faq.id : null)}
          >
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between rounded-md border bg-card p-4 text-left hover:bg-accent">
                <span className="font-medium">{faq.question}</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${openItem === faq.id ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pt-2">
              <p className="text-sm text-muted-foreground">{faq.answer}</p>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    );
  },
};

export const DefaultOpen: Story = {
  render: () => (
    <Collapsible defaultOpen className="w-80">
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          Advanced options
          <ChevronDown className="h-4 w-4" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 rounded-md border bg-card p-4">
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" />
            Enable debugging
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" />
            Show grid lines
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" />
            Auto-save changes
          </label>
        </div>
      </CollapsibleContent>
    </Collapsible>
  ),
};

import type { Meta, StoryObj } from "@storybook/react";
import { SectionList } from "./SectionList";
import { ItemCard } from "../primitives/item-card";
import { Database, File, TableIcon } from "@dashframe/ui/icons";

const meta: Meta<typeof SectionList> = {
  title: "Components/SectionList",
  component: SectionList,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SectionList>;

export const Default: Story = {
  args: {
    title: "Existing Data Tables",
    children: (
      <>
        <ItemCard
          icon={<Database className="h-4 w-4" />}
          title="Sales Data"
          subtitle="150 rows × 8 columns"
          onClick={() => console.log("sales clicked")}
        />
        <ItemCard
          icon={<File className="h-4 w-4" />}
          title="Customers"
          subtitle="Local • 5 fields"
          onClick={() => console.log("customers clicked")}
        />
        <ItemCard
          icon={<TableIcon className="h-4 w-4" />}
          title="Products"
          subtitle="Notion • 12 properties"
          onClick={() => console.log("products clicked")}
        />
      </>
    ),
  },
};

export const Empty: Story = {
  args: {
    title: "Existing Data Tables",
    children: null,
    emptyMessage: "No data tables found. Upload a CSV to get started.",
  },
};

export const SingleItem: Story = {
  args: {
    title: "Recent Sources",
    children: (
      <ItemCard
        icon={<Database className="h-4 w-4" />}
        title="Sales Q4 2024"
        subtitle="Last modified today"
        onClick={() => console.log("clicked")}
      />
    ),
  },
};

export const ManyItems: Story = {
  args: {
    title: "All Data Sources",
    children: (
      <>
        {Array.from({ length: 10 }, (_, i) => (
          <ItemCard
            key={i}
            icon={<Database className="h-4 w-4" />}
            title={`Table ${i + 1}`}
            // eslint-disable-next-line sonarjs/pseudo-random
            subtitle={`${Math.floor(Math.random() * 1000)} rows × ${Math.floor(Math.random() * 20)} columns`}
            onClick={() => console.log(`table ${i + 1} clicked`)}
          />
        ))}
      </>
    ),
  },
};

export const CustomStyling: Story = {
  args: {
    title: "Featured Data",
    titleClassName: "text-lg font-semibold text-foreground",
    contentClassName: "grid-cols-2 gap-4",
    children: (
      <>
        <ItemCard
          icon={<Database className="h-4 w-4" />}
          title="Sales"
          subtitle="150 rows"
          onClick={() => console.log("sales clicked")}
        />
        <ItemCard
          icon={<File className="h-4 w-4" />}
          title="Customers"
          subtitle="200 rows"
          onClick={() => console.log("customers clicked")}
        />
      </>
    ),
  },
};

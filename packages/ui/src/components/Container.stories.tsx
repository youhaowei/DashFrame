import type { Meta, StoryObj } from "@storybook/react";
import { Container } from "./Container";

const meta = {
  title: "Components/Layout/Container",
  component: Container,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  argTypes: {
    maxWidth: {
      control: "select",
      options: ["sm", "md", "lg", "xl", "2xl", "full"],
      description: "Maximum width constraint",
    },
    padding: {
      control: "select",
      options: ["none", "sm", "md", "lg"],
      description: "Horizontal padding",
    },
    as: {
      control: "select",
      options: ["div", "section", "article", "main", "aside"],
      description: "HTML element to render as",
    },
  },
} satisfies Meta<typeof Container>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default container (lg max-width, md padding)
 */
export const Default: Story = {
  args: {
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">Default Container</h2>
        <p className="text-sm">
          This is a standard container with lg max-width (max-w-7xl) and md padding (px-6).
          It centers content and provides consistent horizontal spacing.
        </p>
      </div>
    ),
  },
};

/**
 * Small max-width (for articles, forms)
 */
export const SmallMaxWidth: Story = {
  args: {
    maxWidth: "sm",
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">Small Container</h2>
        <p className="text-sm mb-4">
          This container uses max-w-3xl, perfect for readable content like articles,
          blog posts, or forms where you want shorter line lengths.
        </p>
        <p className="text-sm text-muted-foreground">
          Narrow containers improve readability by preventing lines from becoming
          too long, which can strain the eyes.
        </p>
      </div>
    ),
  },
};

/**
 * Medium max-width
 */
export const MediumMaxWidth: Story = {
  args: {
    maxWidth: "md",
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">Medium Container</h2>
        <p className="text-sm">
          This container uses max-w-5xl, good for content pages that need more space
          than articles but less than full dashboard layouts.
        </p>
      </div>
    ),
  },
};

/**
 * Large max-width (default)
 */
export const LargeMaxWidth: Story = {
  args: {
    maxWidth: "lg",
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">Large Container</h2>
        <p className="text-sm">
          This container uses max-w-7xl, the default for most page layouts.
          Good for dashboards and content-heavy pages.
        </p>
      </div>
    ),
  },
};

/**
 * Extra large max-width
 */
export const ExtraLargeMaxWidth: Story = {
  args: {
    maxWidth: "xl",
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">Extra Large Container</h2>
        <p className="text-sm">
          This container uses max-w-[1400px], great for data-dense dashboards
          or applications that need more horizontal space.
        </p>
      </div>
    ),
  },
};

/**
 * 2XL max-width (very wide)
 */
export const DoubleExtraLargeMaxWidth: Story = {
  args: {
    maxWidth: "2xl",
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">2XL Container</h2>
        <p className="text-sm">
          This container uses max-w-[1600px], for very wide layouts on large displays.
          Use sparingly - most content doesn't need this much width.
        </p>
      </div>
    ),
  },
};

/**
 * Full width (no max-width constraint)
 */
export const FullWidth: Story = {
  args: {
    maxWidth: "full",
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">Full Width Container</h2>
        <p className="text-sm">
          This container uses max-w-full, taking up the entire viewport width.
          Still has horizontal padding for content spacing.
        </p>
      </div>
    ),
  },
};

/**
 * No padding
 */
export const NoPadding: Story = {
  args: {
    maxWidth: "lg",
    padding: "none",
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">No Padding</h2>
        <p className="text-sm">
          This container has no horizontal padding (px-0). Content extends to the edges
          of the container. Useful when you want child elements to control their own spacing.
        </p>
      </div>
    ),
  },
};

/**
 * Small padding
 */
export const SmallPadding: Story = {
  args: {
    maxWidth: "lg",
    padding: "sm",
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">Small Padding</h2>
        <p className="text-sm">
          This container uses px-4 padding. Good for mobile-first designs or
          when you need tighter spacing.
        </p>
      </div>
    ),
  },
};

/**
 * Large padding
 */
export const LargePadding: Story = {
  args: {
    maxWidth: "lg",
    padding: "lg",
    children: (
      <div className="bg-card rounded-2xl border border-border/60 p-6">
        <h2 className="text-lg font-semibold mb-4">Large Padding</h2>
        <p className="text-sm">
          This container uses px-8 padding. Great for spacious layouts on
          larger screens.
        </p>
      </div>
    ),
  },
};

/**
 * As semantic elements
 */
export const SemanticElements: Story = {
  render: () => (
    <div className="space-y-4">
      <Container as="main" maxWidth="lg">
        <div className="bg-card rounded-2xl border border-border/60 p-6">
          <h2 className="text-lg font-semibold mb-2">Main Element</h2>
          <p className="text-sm text-muted-foreground">
            Rendered as &lt;main&gt;
          </p>
        </div>
      </Container>

      <Container as="section" maxWidth="lg">
        <div className="bg-card rounded-2xl border border-border/60 p-6">
          <h2 className="text-lg font-semibold mb-2">Section Element</h2>
          <p className="text-sm text-muted-foreground">
            Rendered as &lt;section&gt;
          </p>
        </div>
      </Container>

      <Container as="article" maxWidth="lg">
        <div className="bg-card rounded-2xl border border-border/60 p-6">
          <h2 className="text-lg font-semibold mb-2">Article Element</h2>
          <p className="text-sm text-muted-foreground">
            Rendered as &lt;article&gt;
          </p>
        </div>
      </Container>
    </div>
  ),
};

/**
 * Dashboard layout example
 */
export const DashboardLayout: Story = {
  args: {
    maxWidth: "2xl",
    padding: "lg",
    children: (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Welcome back! Here's your data overview.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card rounded-2xl border border-border/60 p-6">
            <h3 className="text-sm font-medium mb-1">Data Sources</h3>
            <p className="text-2xl font-bold">12</p>
          </div>
          <div className="bg-card rounded-2xl border border-border/60 p-6">
            <h3 className="text-sm font-medium mb-1">Insights</h3>
            <p className="text-2xl font-bold">45</p>
          </div>
          <div className="bg-card rounded-2xl border border-border/60 p-6">
            <h3 className="text-sm font-medium mb-1">Visualizations</h3>
            <p className="text-2xl font-bold">23</p>
          </div>
        </div>
      </div>
    ),
  },
};

/**
 * Article layout example
 */
export const ArticleLayout: Story = {
  args: {
    maxWidth: "sm",
    padding: "md",
    as: "article",
    children: (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">Article Title</h1>
          <p className="text-muted-foreground text-sm">Published on January 15, 2024</p>
        </div>
        <div className="prose prose-sm">
          <p>
            This is an example of an article layout using a narrow container for
            optimal reading experience. The container width is constrained to
            prevent lines from becoming too long.
          </p>
          <p>
            Long lines of text can be difficult to read and track. By limiting the
            width, we create a more comfortable reading experience that reduces
            eye strain.
          </p>
        </div>
      </div>
    ),
  },
};

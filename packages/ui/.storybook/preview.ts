import type { Preview } from "@storybook/nextjs-vite";
import { createElement } from "react";
import { ThemeWrapper } from "./ThemeWrapper";
import { TooltipProvider } from "../src/primitives/tooltip";
import "../src/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    // Disable Chromatic snapshots by default - enable per-story with chromatic: { disableSnapshot: false }
    chromatic: { disableSnapshot: true },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: "todo",
    },
  },
  tags: ["autodocs"],
  globalTypes: {
    theme: {
      description: "Global theme for components",
      defaultValue: "system",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "system", icon: "browser", title: "System" },
          { value: "light", icon: "sun", title: "Light" },
          { value: "dark", icon: "moon", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || "system";
      return createElement(
        ThemeWrapper,
        { theme },
        createElement(TooltipProvider, null, createElement(Story)),
      );
    },
  ],
};

export default preview;

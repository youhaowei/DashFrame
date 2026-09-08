import type { Preview } from "@storybook/nextjs-vite";
import { TooltipProvider } from "@wystack/ui-react";
import { createElement } from "react";
import "../src/globals.css";
import { ThemeWrapper } from "./ThemeWrapper";

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
      // The value below only reports a11y violations in the test UI;
      // "error" fails CI on them and "off" skips the checks entirely.
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

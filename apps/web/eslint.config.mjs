import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import sharedConfig, { sharedRules } from "@dashframe/eslint-config";

const stripDuplicateTypescriptPlugin = (config) => {
  if (
    !config ||
    typeof config !== "object" ||
    !config.plugins ||
    !config.plugins["@typescript-eslint"]
  ) {
    return config;
  }

  const otherPlugins = { ...config.plugins };
  delete otherPlugins["@typescript-eslint"];

  if (Object.keys(otherPlugins).length === 0) {
    const configWithoutPlugins = { ...config };
    delete configWithoutPlugins.plugins;
    return configWithoutPlugins;
  }

  return {
    ...config,
    plugins: otherPlugins,
  };
};

const nextTypescriptWithoutDuplicatePlugin = nextTypescript.map(
  stripDuplicateTypescriptPlugin,
);

export default defineConfig([
  ...sharedConfig,
  ...nextCoreWebVitals,
  ...nextTypescriptWithoutDuplicatePlugin,
  {
    rules: {
      ...sharedRules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-icons",
              message: "Use @dashframe/ui/icons instead of react-icons directly.",
            },
            {
              name: "react-icons/lu",
              message: "Use @dashframe/ui/icons instead of react-icons directly.",
            },
            {
              name: "@dashframe/ui",
              importNames: [
                // Navigation & Layout
                "ArrowLeft",
                "ArrowRight",
                "ArrowUpDown",
                "ChevronDown",
                "ChevronUp",
                "ChevronRight",
                "ChevronLeft",
                "ChevronsLeft",
                "ChevronsRight",
                "ChevronsUp",
                "ChevronsDown",
                "ChevronsUpDown",
                "Menu",
                "DragHandle",
                // Pages & Views
                "Dashboard",
                "Grid",
                // Actions
                "Plus",
                "Edit",
                "Delete",
                "Copy",
                "Refresh",
                "Close",
                "Eye",
                "ExternalLink",
                "Merge",
                // Settings & Configuration
                "Settings",
                "Shield",
                "More",
                // Theme & Appearance
                "Moon",
                "Sun",
                // Data Visualization
                "Chart",
                "Table",
                "List",
                "Layers",
                // Data Sources & Files
                "Database",
                "File",
                "Notion",
                "Cloud",
                "Spreadsheet",
                "Calculator",
                // Brands
                "Github",
                // Status & Feedback
                "Check",
                "CheckCircle",
                "CheckSquare",
                "Alert",
                "Info",
                "Loader",
                "Pending",
                // Data Types
                "TextType",
                "NumberType",
                "DateType",
                "BooleanType",
                // UI Elements
                "Circle",
                "Dot",
                "DataPoint",
                // Utilities
                "Sparkles",
                "Help",
                "Terminal",
                "Lightbulb",
                "Search",
                "Users",
              ],
              message: "Import icons from @dashframe/ui/icons instead of @dashframe/ui.",
            },
          ],
          patterns: [
            {
              group: ["react-icons/*"],
              message: "Use @dashframe/ui/icons instead of react-icons directly.",
            },
          ],
        },
      ],
    },
  },
]);

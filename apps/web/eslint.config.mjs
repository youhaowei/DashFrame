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
                "ArrowLeft",
                "ArrowRight",
                "ArrowUpDown",
                "BarChart3",
                "Check",
                "CheckIcon",
                "ChevronDown",
                "ChevronLeft",
                "ChevronRight",
                "ChevronUp",
                "ChevronsLeft",
                "ChevronsRight",
                "Cloud",
                "Database",
                "DataPoint",
                "Edit3",
                "ExternalLink",
                "Eye",
                "File",
                "FileSpreadsheet",
                "FileText",
                "Grip",
                "Hash",
                "LayoutDashboard",
                "LayoutGrid",
                "Layers",
                "LineChart",
                "LinkExternal",
                "LinkOut",
                "Loader",
                "Loader2",
                "Menu",
                "MoreHorizontal",
                "MoreOptions",
                "Plus",
                "Refresh",
                "Search",
                "Settings",
                "Sparkles",
                "Spinner",
                "TableIcon",
                "Trash2",
                "X",
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

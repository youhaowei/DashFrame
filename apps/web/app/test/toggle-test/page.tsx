"use client";

import { useState } from "react";
import {
  ChartIcon,
  TableIcon,
  ListIcon,
  GridIcon,
  LightModeIcon,
  DarkModeIcon,
  Toggle,
  Card,
} from "@dashframe/ui";

export default function ToggleTestPage() {
  const [defaultVariantValue, setDefaultVariantValue] = useState("chart");
  const [outlineVariantValue, setOutlineVariantValue] = useState("compact");
  const [smallDefaultVariant, setSmallDefaultVariant] = useState("chart");
  const [smallOutlineVariant, setSmallOutlineVariant] = useState("compact");

  return (
    <div className="container mx-auto space-y-8 p-8">
      <h1 className="text-3xl font-bold">Toggle Component Test</h1>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">
          Default Variant - Default Size
        </h2>
        <p className="text-muted-foreground">
          Standard size with filled background style
        </p>
        <Card className="p-4">
          <Toggle
            variant="default"
            size="default"
            value={defaultVariantValue}
            onValueChange={setDefaultVariantValue}
            options={[
              {
                value: "chart",
                icon: <ChartIcon className="h-4 w-4" />,
                label: "Chart",
              },
              {
                value: "table",
                icon: <TableIcon className="h-4 w-4" />,
                label: "Data Table",
                badge: 100,
              },
              {
                value: "both",
                icon: <ListIcon className="h-4 w-4" />,
                label: "Both",
              },
            ]}
          />
          <p className="text-muted-foreground mt-2 text-sm">
            Selected value: {defaultVariantValue}
          </p>
        </Card>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Default Variant - Small Size</h2>
        <p className="text-muted-foreground">
          Small size with filled background style
        </p>
        <Card className="p-4">
          <Toggle
            variant="default"
            size="sm"
            value={smallDefaultVariant}
            onValueChange={setSmallDefaultVariant}
            options={[
              {
                value: "chart",
                icon: <ChartIcon className="h-3 w-3" />,
                label: "Chart",
              },
              {
                value: "table",
                icon: <TableIcon className="h-3 w-3" />,
                label: "Table",
                badge: 100,
              },
              {
                value: "both",
                icon: <ListIcon className="h-3 w-3" />,
                label: "Both",
              },
            ]}
          />
          <p className="text-muted-foreground mt-2 text-sm">
            Selected value: {smallDefaultVariant}
          </p>
        </Card>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">
          Outline Variant - Default Size
        </h2>
        <p className="text-muted-foreground">
          Standard size with outline style
        </p>
        <Card className="p-4">
          <Toggle
            variant="outline"
            size="default"
            value={outlineVariantValue}
            onValueChange={setOutlineVariantValue}
            options={[
              {
                value: "compact",
                icon: <ListIcon className="h-4 w-4" />,
                tooltip: "Compact view",
                ariaLabel: "Compact view",
              },
              {
                value: "expanded",
                icon: <GridIcon className="h-4 w-4" />,
                tooltip: "Expanded view",
                ariaLabel: "Expanded view",
              },
            ]}
          />
          <p className="text-muted-foreground mt-2 text-sm">
            Selected value: {outlineVariantValue}
          </p>
        </Card>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Outline Variant - Small Size</h2>
        <p className="text-muted-foreground">
          Small size with outline style (NEW)
        </p>
        <Card className="p-4">
          <Toggle
            variant="outline"
            size="sm"
            value={smallOutlineVariant}
            onValueChange={setSmallOutlineVariant}
            options={[
              {
                value: "compact",
                icon: <ListIcon className="h-3 w-3" />,
                tooltip: "Compact view",
                ariaLabel: "Compact view",
              },
              {
                value: "expanded",
                icon: <GridIcon className="h-3 w-3" />,
                tooltip: "Expanded view",
                ariaLabel: "Expanded view",
              },
            ]}
          />
          <p className="text-muted-foreground mt-2 text-sm">
            Selected value: {smallOutlineVariant}
          </p>
        </Card>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Theme Toggle Example</h2>
        <p className="text-muted-foreground">
          Example with small size theme toggle
        </p>
        <Card className="p-4">
          <Toggle
            variant="outline"
            size="sm"
            value="light"
            onValueChange={() => {}}
            options={[
              {
                value: "light",
                icon: <LightModeIcon className="h-3 w-3" />,
                tooltip: "Light mode",
                ariaLabel: "Switch to light mode",
              },
              {
                value: "dark",
                icon: <DarkModeIcon className="h-3 w-3" />,
                tooltip: "Dark mode",
                ariaLabel: "Switch to dark mode",
              },
            ]}
          />
        </Card>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Disabled State Test</h2>
        <p className="text-muted-foreground">
          Testing disabled state with small size
        </p>
        <Card className="p-4">
          <Toggle
            variant="outline"
            size="sm"
            value="option1"
            onValueChange={() => {}}
            options={[
              {
                value: "option1",
                icon: <LightModeIcon className="h-3 w-3" />,
                label: "Enabled",
              },
              {
                value: "option2",
                icon: <DarkModeIcon className="h-3 w-3" />,
                label: "Disabled",
                disabled: true,
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

"use client";

import { type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Alert,
  AlertDescription,
} from "@dashframe/ui";
import { Notion } from "@dashframe/ui/icons";

export interface NotionConfig {
  title?: string;
  description?: string;
  hint?: string;
  apiKey: string;
  showApiKey: boolean;
  onApiKeyChange: (value: string) => void;
  onToggleShowApiKey: () => void;
  onConnectNotion: () => void;
  connectButtonLabel?: string;
  connectDisabled?: boolean;
  notionChildren?: ReactNode;
}

interface AddConnectionPanelProps {
  error?: string | null;
  csvTitle?: string;
  csvDescription?: string;
  csvHelperText?: string;
  onCsvSelect: (file: File) => void;
  /**
   * Notion configuration. If omitted, the Notion card is not rendered.
   */
  notion?: NotionConfig;
}

export function AddConnectionPanel({
  error,
  csvTitle = "CSV File",
  csvDescription = "Upload a CSV file with headers in the first row.",
  csvHelperText = "Supports .csv files up to 5MB",
  onCsvSelect,
  notion,
}: AddConnectionPanelProps) {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onCsvSelect(file);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <pre className="overflow-auto text-xs">{error}</pre>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base font-semibold">
              {csvTitle}
            </CardTitle>
            <p className="text-muted-foreground text-sm">{csvDescription}</p>
          </CardHeader>
          <CardContent>
            <label className="border-input bg-muted/50 hover:border-primary hover:bg-muted flex cursor-pointer flex-col items-center justify-center rounded-xl border p-6 text-center text-sm font-medium transition">
              <span className="text-foreground">Select CSV File</span>
              <span
                id="csv-helper-text"
                className="text-muted-foreground mt-2 text-xs font-normal"
              >
                {csvHelperText}
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-describedby="csv-helper-text"
                onChange={handleFileChange}
              />
            </label>
          </CardContent>
        </Card>

        {notion && (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2 text-base font-semibold">
                <Notion className="h-5 w-5" />
                {notion.title ?? "Notion"}
              </CardTitle>
              {notion.description && (
                <p className="text-muted-foreground text-sm">
                  {notion.description}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="add-connection-api-key">API Key</Label>
                <span className="text-muted-foreground text-xs">
                  {notion.hint ?? "Stored locally in your browser."}
                </span>
              </div>
              <div className="relative">
                <Input
                  id="add-connection-api-key"
                  type={notion.showApiKey ? "text" : "password"}
                  value={notion.apiKey}
                  onChange={(event) =>
                    notion.onApiKeyChange(event.target.value)
                  }
                  placeholder="secret_..."
                  className="pr-16"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={notion.onToggleShowApiKey}
                  className="absolute right-1 top-1/2 h-7 -translate-y-1/2 text-xs"
                >
                  {notion.showApiKey ? "Hide" : "Show"}
                </Button>
              </div>
              <Button
                onClick={notion.onConnectNotion}
                disabled={notion.connectDisabled}
                className="w-full"
              >
                {notion.connectButtonLabel ?? "Connect"}
              </Button>
              {notion.notionChildren}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@dashframe/ui";
import { Button } from "@dashframe/ui/primitives/button";
import { CheckIcon, CloseIcon } from "@dashframe/ui/icons";

interface MarkdownWidgetProps {
  content: string;
  isEditing: boolean;
  onSave: (content: string) => void;
  onCancel: () => void;
  className?: string;
}

export function MarkdownWidget({
  content,
  isEditing,
  onSave,
  onCancel,
  className,
}: MarkdownWidgetProps) {
  const [value, setValue] = useState(content);

  useEffect(() => {
    setValue(content);
  }, [content]);

  if (isEditing) {
    return (
      <div className={cn("flex h-full flex-col gap-2 p-2", className)}>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-20 w-full flex-1 resize-none rounded-md border px-3 py-2 font-mono text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Enter markdown..."
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="text"
            size="sm"
            onClick={() => {
              setValue(content);
              onCancel();
            }}
          >
            <CloseIcon className="mr-1 h-3 w-3" />
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSave(value)}>
            <CheckIcon className="mr-1 h-3 w-3" />
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert h-full max-w-none overflow-auto p-4",
        className,
      )}
    >
      <ReactMarkdown>{content || "*No content*"}</ReactMarkdown>
    </div>
  );
}

"use client";

import { CheckIcon, CloseIcon } from "@stdui/icons";
import { Button, cn } from "@stdui/react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

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
  // Reset edit buffer whenever the source `content` changes by using it as
  // the state's identity — derive the current value during render.
  const [value, setValue] = useState(content);
  const [lastContent, setLastContent] = useState(content);
  if (lastContent !== content) {
    setLastContent(content);
    setValue(content);
  }

  if (isEditing) {
    return (
      <div className={cn("flex h-full flex-col gap-2 p-2", className)}>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex min-h-20 w-full flex-1 resize-none rounded-md border border-neutral-border bg-neutral-bg px-3 py-2 font-mono text-sm ring-offset-neutral-bg placeholder:text-neutral-fg-subtle focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Enter markdown..."
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button
            label="Cancel"
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue(content);
              onCancel();
            }}
          >
            <CloseIcon className="mr-1 h-3 w-3" />
            Cancel
          </Button>
          <Button label="Save" size="sm" onClick={() => onSave(value)}>
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

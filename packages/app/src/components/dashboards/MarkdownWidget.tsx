import { Button, cn } from "@wystack/ui-react";
import { CheckIcon, CloseIcon } from "@wystack/ui-react/icons";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

interface MarkdownWidgetProps {
  content: string;
  isEditing: boolean;
  onSave: (content: string) => void;
  onCancel: () => void;
  /** True while an onSave round-trip is in flight — locks the editor so a
   *  keystroke after Save can't be silently dropped by the delayed close. */
  isSaving?: boolean;
  className?: string;
}

export function MarkdownWidget({
  content,
  isEditing,
  onSave,
  onCancel,
  isSaving = false,
  className,
}: MarkdownWidgetProps) {
  // Edit buffer — initialized from `content` and synced with external changes
  // (i.e. saved from another session or undo) only while not editing.
  const [value, setValue] = useState(content);
  const prevContentRef = useRef(content);
  const wasEditingRef = useRef(isEditing);
  useEffect(() => {
    if (
      !isEditing &&
      (wasEditingRef.current || prevContentRef.current !== content)
    ) {
      setValue(content);
    }
    prevContentRef.current = content;
    wasEditingRef.current = isEditing;
  }, [content, isEditing]);

  if (isEditing) {
    return (
      <div className={cn("flex h-full flex-col gap-2 p-2", className)}>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={isSaving}
          className="flex min-h-20 w-full flex-1 resize-none rounded-md border border-neutral-border bg-neutral-bg px-3 py-2 font-mono text-sm ring-offset-neutral-bg placeholder:text-neutral-fg-subtle focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Enter markdown..."
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button
            label="Cancel"
            variant="ghost"
            size="sm"
            disabled={isSaving}
            onClick={() => {
              setValue(content);
              onCancel();
            }}
          >
            <CloseIcon className="mr-1 h-3 w-3" />
            Cancel
          </Button>
          <Button
            label="Save"
            size="sm"
            disabled={isSaving}
            onClick={() => onSave(value)}
          >
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

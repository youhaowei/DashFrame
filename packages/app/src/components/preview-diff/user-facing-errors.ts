/** User-facing copy for preview/draft flows — never surface raw runtime errors. */

export function previewFailureSummary(commandIndex: number): string {
  return `Command ${commandIndex + 1} in this draft could not be previewed. Review or edit the draft, then try again.`;
}

export function previewFailureDetail(): string {
  return "One command in this draft could not be previewed. Discard this draft or go back and fix the failing command before publishing.";
}

export function draftLifecycleErrorDescription(error: unknown): string {
  if (!(error instanceof Error)) return "Please try again.";

  const message = error.message;
  if (message.includes("late-bound operands")) {
    return "This draft still has values that need binding before it can publish.";
  }
  if (message.includes("changed since review")) {
    return "The draft changed after you opened this review. Refresh the page and review again before publishing.";
  }
  return "Please try again.";
}

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantProviderSettingsDialog } from "./AssistantProviderSettingsDialog";

const { saveConfigMutation } = vi.hoisted(() => ({
  saveConfigMutation: vi.fn(),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => {
      if (ref._path === "listAssistantProviderConfigs") {
        return {
          data: [
            {
              id: "provider-1",
              providerId: "openai",
              displayLabel: "OpenAI",
              authKind: "api-key",
              defaultModel: "gpt-4.1",
              hasCredential: true,
              isDefault: true,
            },
          ],
          isLoading: false,
        };
      }
      return {
        data: [
          {
            providerId: "openai",
            label: "OpenAI",
            authKinds: ["api-key", "oauth", "local"],
            models: [{ id: "gpt-4.1", name: "GPT 4.1" }],
          },
        ],
        isLoading: false,
      };
    },
    useMutation: (ref: { _path: string }) => ({
      mutateAsync:
        ref._path === "saveAssistantProviderConfig"
          ? saveConfigMutation
          : vi.fn(),
    }),
  };
});

vi.mock("@wystack/ui-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/ui-react")>();
  const React = await import("react");
  const SelectContent = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const SelectItem = ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>;
  return {
    ...actual,
    Select: ({
      children,
      onValueChange,
      value,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
      value: string;
    }) => {
      const content = React.Children.toArray(children).find(
        (child) => React.isValidElement(child) && child.type === SelectContent,
      ) as React.ReactElement<{ children: React.ReactNode }> | undefined;
      return (
        <select
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {content?.props.children}
        </select>
      );
    },
    SelectContent,
    SelectItem,
    SelectTrigger: () => null,
    SelectValue: () => null,
  };
});

describe("AssistantProviderSettingsDialog", () => {
  beforeEach(() => {
    saveConfigMutation.mockReset();
    saveConfigMutation.mockResolvedValue({ id: "provider-1" });
  });

  it("clears an API key after changing auth mode and updates the existing config", async () => {
    render(<AssistantProviderSettingsDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(document.querySelector('input[type="password"]')!, {
      target: { value: "stale-api-key" },
    });
    fireEvent.change(screen.getAllByRole("combobox")[1]!, {
      target: { value: "oauth" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    await waitFor(() => expect(saveConfigMutation).toHaveBeenCalledTimes(1));
    expect(saveConfigMutation).toHaveBeenCalledWith({
      input: {
        id: "provider-1",
        providerId: "openai",
        displayLabel: "OpenAI",
        authKind: "oauth",
        baseUrl: undefined,
        credential: undefined,
        defaultModel: "gpt-4.1",
        isDefault: false,
      },
    });
  });
});

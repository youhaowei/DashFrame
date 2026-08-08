import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistantStore } from "@/lib/stores/assistant-store";

import { AssistantModelPicker } from "./AssistantModelPicker";

const { modelCalls, modelResolvers } = vi.hoisted(() => ({
  modelCalls: [] as Array<{ input: Record<string, string> }>,
  modelResolvers: [] as Array<() => void>,
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
            models: [
              { id: "gpt-4.1", name: "GPT 4.1" },
              { id: "gpt-4.1-mini", name: "GPT 4.1 mini" },
              { id: "gpt-4.1-nano", name: "GPT 4.1 nano" },
            ],
          },
        ],
        isLoading: false,
      };
    },
    useMutation: (ref: { _path: string }) => ({
      mutateAsync: (args: { input: Record<string, string> }) => {
        if (ref._path !== "setAssistantDefaultModel") {
          return Promise.resolve(undefined);
        }
        modelCalls.push(args);
        return new Promise<void>((resolve) => modelResolvers.push(resolve));
      },
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

describe("AssistantModelPicker", () => {
  beforeEach(() => {
    modelCalls.length = 0;
    modelResolvers.length = 0;
    useAssistantStore.setState({
      selectedProviderConfigId: "provider-1",
      selectedModelId: "gpt-4.1",
    });
  });

  it("serializes rapid model selections so the latest one is persisted last", async () => {
    render(<AssistantModelPicker />);

    const modelSelect = screen.getAllByRole("combobox")[1]!;
    fireEvent.change(modelSelect, { target: { value: "gpt-4.1-mini" } });
    await waitFor(() => expect(modelCalls).toHaveLength(1));

    fireEvent.change(modelSelect, { target: { value: "gpt-4.1-nano" } });
    expect(modelCalls).toHaveLength(1);

    modelResolvers.shift()!();
    await waitFor(() => expect(modelCalls).toHaveLength(2));
    modelResolvers.shift()!();

    await waitFor(() =>
      expect(useAssistantStore.getState().selectedModelId).toBe("gpt-4.1-nano"),
    );
    expect(modelCalls).toEqual([
      {
        input: {
          id: "provider-1",
          expectedDefaultModel: "gpt-4.1",
          defaultModel: "gpt-4.1-mini",
        },
      },
      {
        input: {
          id: "provider-1",
          expectedDefaultModel: "gpt-4.1-mini",
          defaultModel: "gpt-4.1-nano",
        },
      },
    ]);
  });
});

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistantStore } from "@/lib/stores/assistant-store";

import { AssistantModelPicker } from "./AssistantModelPicker";

const { modelCalls, modelResolvers, modelRejecters, configsData, catalogData } =
  vi.hoisted(() => ({
    modelCalls: [] as Array<{ input: Record<string, string> }>,
    modelResolvers: [] as Array<() => void>,
    modelRejecters: [] as Array<(reason: Error) => void>,
    // Held by identity, the way react-query hands back the same `data`
    // reference between refetches. A fresh array per render would re-run the
    // picker's configs effect on every render and silently reset the
    // compare-and-swap baseline, which would mask exactly the failure-path
    // behavior the second test is there to pin.
    configsData: [
      {
        id: "provider-1",
        providerId: "openai",
        displayLabel: "OpenAI",
        authKind: "api-key",
        defaultModel: "gpt-4.1",
        isDefault: true,
      },
    ],
    catalogData: [
      {
        providerId: "openai",
        models: [
          { id: "gpt-4.1", name: "GPT 4.1" },
          { id: "gpt-4.1-mini", name: "GPT 4.1 mini" },
          { id: "gpt-4.1-nano", name: "GPT 4.1 nano" },
        ],
      },
    ],
  }));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => {
      if (ref._path === "listAssistantProviderConfigs") {
        return { data: configsData, isLoading: false };
      }
      return { data: catalogData, isLoading: false };
    },
    useMutation: (ref: { _path: string }) => ({
      mutateAsync: (args: { input: Record<string, string> }) => {
        if (ref._path !== "setAssistantDefaultModel") {
          return Promise.resolve(undefined);
        }
        modelCalls.push(args);
        return new Promise<void>((resolve, reject) => {
          modelResolvers.push(resolve);
          modelRejecters.push(reject);
        });
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
    modelRejecters.length = 0;
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

  it("keeps draining, and does not advance the compare-and-swap baseline, after a rejected write", async () => {
    render(<AssistantModelPicker />);

    const modelSelect = screen.getAllByRole("combobox")[1]!;
    fireEvent.change(modelSelect, { target: { value: "gpt-4.1-mini" } });
    await waitFor(() => expect(modelCalls).toHaveLength(1));

    modelRejecters.shift()!(
      new Error("Assistant model changed before this update could be saved"),
    );
    modelResolvers.shift();

    // Let the rejection actually propagate through the drain loop's catch and
    // finally before selecting again. Without this the next selection queues in
    // the same synchronous turn, capturing the baseline before the failure path
    // has had any chance to touch it — which would make the assertion below
    // pass no matter what that path does.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // A rejection must not wedge the drain loop: the next selection still
    // reaches the server.
    fireEvent.change(modelSelect, { target: { value: "gpt-4.1-nano" } });
    await waitFor(() => expect(modelCalls).toHaveLength(2));

    // The baseline deliberately stays at the last value the server is known to
    // have accepted. A write that failed did not land, so claiming its model as
    // the new baseline would send a compare-and-swap that can never match.
    expect(modelCalls[1]!.input.expectedDefaultModel).toBe("gpt-4.1");

    // The optimistic selection is intentionally left in place rather than
    // rolled back: the rail runs against the picked model per request, so the
    // user's choice stays honored while the error toast reports that saving it
    // as the default did not stick.
    expect(useAssistantStore.getState().selectedModelId).toBe("gpt-4.1-nano");
  });
});

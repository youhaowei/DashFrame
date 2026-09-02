import { api } from "@dashframe/convex-backend/api";
import { render } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vite-plus/test";

const { mutationReferences } = vi.hoisted(() => ({
  mutationReferences: [] as unknown[],
}));

vi.mock("@/data/connector-catalog", () => ({
  useConnectorCatalog: () => ({ data: [] }),
}));

vi.mock("convex/react", () => ({
  useMutation: (reference: unknown) => {
    mutationReferences.push(reference);
    return vi.fn();
  },
  useQuery_experimental: () => ({ status: "success", data: [] }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ buildLocation: vi.fn() }),
  useRouterState: () => "/",
}));

vi.mock("./highlight", () => ({
  useWebMCPHighlightController: () => ({ highlight: vi.fn() }),
}));

vi.mock("./webmcp", () => ({ useWebMCPTools: vi.fn() }));

import { WebMCPProvider } from "./WebMCPProvider";

describe("WebMCPProvider", () => {
  it("binds the tool mutation surface to draftBatch", () => {
    mutationReferences.length = 0;
    render(
      <WebMCPProvider>
        <div />
      </WebMCPProvider>,
    );
    expect(
      mutationReferences.map((reference) => getFunctionName(reference)),
    ).toEqual([getFunctionName(api.app.draftBatch)]);
  });
});

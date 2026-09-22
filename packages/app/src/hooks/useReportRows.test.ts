import { describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { loadReportRows, useReportRows } from "./useReportRows";
describe("canonical report row sharing", () => {
  it("shares all pages between the pivot and its sort menu", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ channel: "Web" }], totalCount: 2 })
      .mockResolvedValueOnce({ rows: [{ channel: "Store" }], totalCount: 2 });
    const [table, menu] = await Promise.all([
      loadReportRows(fetch, 2),
      loadReportRows(fetch, 2),
    ]);
    expect(table).toBe(menu);
    expect(table).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("allows a failed complete read to be retried instead of caching partial data", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost connection"))
      .mockResolvedValueOnce({ rows: [{ channel: "Web" }], totalCount: 1 });
    await expect(loadReportRows(fetch, 1)).rejects.toThrow("lost connection");
    await expect(loadReportRows(fetch, 1)).resolves.toEqual([
      { channel: "Web" },
    ]);
  });
});

it("recovers both mounted consumers after one retry with unchanged fetch identity", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ rows: [{ channel: "Web" }], totalCount: 1 });
  const { result } = renderHook(() => [
    useReportRows(fetch, 1),
    useReportRows(fetch, 1),
  ]);
  await waitFor(() => expect(result.current[0]?.error).toBe("offline"));
  expect(result.current[1]?.error).toBe("offline");
  act(() => result.current[0]?.retry());
  await waitFor(() =>
    expect(result.current[0]?.rows).toEqual([{ channel: "Web" }]),
  );
  expect(result.current[1]?.rows).toBe(result.current[0]?.rows);
  expect(result.current[1]?.error).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(2);
});

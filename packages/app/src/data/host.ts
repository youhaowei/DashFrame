import type {
  HostOperationArgs,
  HostOperationName,
  HostOperationResult,
} from "@dashframe/server/host-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRuntimeConfig, hostHeaders } from "./runtime";

/** Host resources are HTTP operations; metadata is accessed through Convex. */
export async function requestHost<K extends HostOperationName>(
  operation: K,
  args: HostOperationArgs<K>,
): Promise<HostOperationResult<K>> {
  const config = getRuntimeConfig();
  const response = await fetch(new URL(`/api/host/${operation}`, config.url), {
    method: "POST",
    headers: { ...hostHeaders(config), "Content-Type": "application/json" },
    body: JSON.stringify(args),
    credentials: "same-origin",
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Host operation ${operation} failed (${response.status})`;
    throw new Error(message);
  }
  return body as HostOperationResult<K>;
}

export function useHostQuery<K extends HostOperationName>(
  operation: K,
  options?: { args?: HostOperationArgs<K>; skip?: boolean },
) {
  const args = options?.args ?? ({} as HostOperationArgs<K>);
  return useQuery({
    queryKey: ["host", operation, args],
    queryFn: () => requestHost(operation, args),
    enabled: !options?.skip,
  });
}

export function useHostMutation<K extends HostOperationName>(operation: K) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (args: HostOperationArgs<K>) => requestHost(operation, args),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["host"] }),
  });
}

import type {
  HostOperationArgs,
  HostOperationName,
  HostOperationResult,
} from "@dashframe/server/host-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRuntimeConfig, hostHeaders } from "./runtime";

export class HostOperationError extends Error {
  constructor(
    message: string,
    readonly operationId?: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HostOperationError";
  }
}

/** Host resources are HTTP operations; metadata is accessed through Convex. */
export async function requestHost<K extends HostOperationName>(
  operation: K,
  args: HostOperationArgs<K>,
): Promise<HostOperationResult<K>> {
  const config = getRuntimeConfig();
  let operationId: string | undefined;
  if (operation === "commitBatch") {
    operationId =
      "operationId" in args && typeof args.operationId === "string"
        ? args.operationId
        : crypto.randomUUID();
  }
  const payload = operationId ? { ...args, operationId } : args;
  const { response, body } = await readHostResponse(
    new URL(`/api/host/${operation}`, config.url),
    {
      method: "POST",
      headers: { ...hostHeaders(config), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
    },
    operationId,
  );
  if (!response.ok)
    throw responseError(operation, response.status, body, operationId);
  return body as HostOperationResult<K>;
}

async function readHostResponse(
  url: URL,
  init: RequestInit,
  operationId?: string,
) {
  try {
    const response = await fetch(url, init);
    const body: unknown = await response.json();
    return { response, body };
  } catch (error) {
    if (operationId)
      throw new HostOperationError(
        "Host command outcome is unconfirmed; retry with the same operation ID",
        operationId,
        "HOST_BATCH_OUTCOME_UNKNOWN",
      );
    throw error;
  }
}
function responseError(
  operation: string,
  status: number,
  body: unknown,
  operationId?: string,
) {
  const details = body && typeof body === "object" ? body : {};
  return new HostOperationError(
    "error" in details && typeof details.error === "string"
      ? details.error
      : `Host operation ${operation} failed (${status})`,
    "operationId" in details && typeof details.operationId === "string"
      ? details.operationId
      : operationId,
    "code" in details && typeof details.code === "string"
      ? details.code
      : undefined,
  );
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

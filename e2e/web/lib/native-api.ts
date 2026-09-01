/** Exercise the same authenticated native metadata endpoint used by the renderer. */
export async function nativeCall<T>(
  kind: "query" | "mutation",
  path: string,
  args: unknown,
  token = process.env.E2E_USER_TOKEN ?? "dashframe-e2e-user",
): Promise<T> {
  const url = process.env.E2E_DASHFRAME_URL;
  if (!url) throw new Error("E2E_DASHFRAME_URL was not configured");
  const issued = await fetch(`${url}/api/convex-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!issued.ok)
    throw new Error(`Native authentication failed: ${issued.status}`);
  const identity = (await issued.json()) as { token: string };
  const response = await fetch(`${url}/api/convex/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${identity.token}`,
    },
    body: JSON.stringify({
      path: `app:${path}`,
      format: "convex_encoded_json",
      args: [args],
    }),
  });
  const result = (await response.json()) as {
    status: string;
    value?: T;
    errorMessage?: string;
  };
  if (!response.ok || result.status !== "success")
    throw new Error(
      result.errorMessage ?? `${path} failed: ${response.status}`,
    );
  return result.value as T;
}

export const query = <T>(path: string, args: unknown, token?: string) =>
  nativeCall<T>("query", path, args, token);
export const mutate = <T>(path: string, args: unknown, token: string) =>
  nativeCall<T>("mutation", path, args, token);

export async function hostCall<T>(
  path: string,
  args: unknown,
  token = process.env.E2E_USER_TOKEN ?? "dashframe-e2e-user",
): Promise<T> {
  const response = await fetch(
    `${process.env.E2E_DASHFRAME_URL}/api/host/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
    },
  );
  if (!response.ok)
    throw new Error(
      `${path} failed: ${response.status} ${await response.text()}`,
    );
  return (await response.json()) as T;
}

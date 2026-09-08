/** Cookie-authenticated reads may omit Origin; browser writes must name our origin. */
export function isHostedOriginAllowed(
  request: Request,
  publicOrigin: string,
): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === publicOrigin;
  return request.method === "GET" || request.method === "HEAD";
}

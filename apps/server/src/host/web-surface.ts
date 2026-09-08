import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
  [".map", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

export function parseHeadersFile(source: string): Array<[string, string]> {
  const headers: Array<[string, string]> = [];
  let inCatchAll = false;
  for (const rawLine of source.split("\n")) {
    if (!rawLine.trim()) continue;
    if (!/^\s/.test(rawLine)) {
      inCatchAll = rawLine.trim() === "/*";
      continue;
    }
    if (!inCatchAll) continue;
    const line = rawLine.trim();
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    headers.push([
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    ]);
  }
  return headers;
}

async function containedFile(root: string, candidate: string): Promise<string> {
  const canonical = await realpath(candidate);
  if (!canonical.startsWith(root + path.sep))
    throw new Error("Static file escapes the built bundle");
  return canonical;
}

async function readSecurityHeaders(
  staticRoot: string,
): Promise<Array<[string, string]>> {
  const file = path.join(staticRoot, "_headers");
  let source: string;
  try {
    source = await readFile(await containedFile(staticRoot, file), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw new Error(
        `The built web app at ${staticRoot} has no _headers file. Run \`turbo build --filter=@dashframe/web\` so the security headers are emitted alongside it.`,
        { cause: error },
      );
    throw error;
  }
  const headers = parseHeadersFile(source);
  if (headers.length === 0)
    throw new Error(`No catch-all header block found in ${file}`);
  return headers;
}

export function resolveStaticPath(
  root: string,
  urlPath: string,
): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, `.${path.posix.sep}${decoded}`);
  if (
    candidate !== resolvedRoot &&
    !candidate.startsWith(resolvedRoot + path.sep)
  )
    return undefined;
  return candidate;
}

/** Serve public build assets; API authentication belongs to the hosted entrypoint. */
export async function createStaticWebSurface(
  staticRoot: string,
): Promise<(request: Request) => Promise<Response>> {
  const root = await realpath(staticRoot);
  let index: string;
  try {
    index = await containedFile(root, path.join(root, "index.html"));
    await stat(index);
  } catch {
    throw new Error(
      `No index.html in ${root}. Point --static-root at a built web app (apps/web/dist).`,
    );
  }
  const securityHeaders = await readSecurityHeaders(root);
  return async (request) => {
    const urlPath = new URL(request.url).pathname;
    const resolved = resolveStaticPath(root, urlPath);
    let file = resolved;
    if (file) {
      try {
        file = await containedFile(root, file);
        if ((await stat(file)).isDirectory()) file = undefined;
      } catch {
        file = undefined;
      }
    }
    const isShell = file === undefined || file === index;
    const target = file ?? index;
    const [body, stats] = await Promise.all([readFile(target), stat(target)]);
    const etag = `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
    const headers = new Headers(securityHeaders);
    headers.set(
      "Content-Type",
      CONTENT_TYPES.get(path.extname(target).toLowerCase()) ??
        "application/octet-stream",
    );
    let cacheControl = "public, max-age=3600";
    if (isShell) cacheControl = "no-cache";
    else if (urlPath.startsWith("/assets/"))
      cacheControl = "public, max-age=31536000, immutable";
    headers.set("Cache-Control", cacheControl);
    headers.set("ETag", etag);
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    return new Response(body, { status: 200, headers });
  };
}

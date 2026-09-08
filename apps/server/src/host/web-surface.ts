/**
 * Serve the built web app from the host, on the host's own origin.
 *
 * The renderer already resolves its host as `location.origin` and talks to
 * `/api/...` (packages/app/src/data/runtime.tsx). Serving the bundle from the
 * same process therefore needs no renderer change at all, and it removes three
 * whole classes of hosted problem before they start: no CORS preflight on every
 * host call, no cross-origin cookie, and no CSP allowlist entry for a separate
 * API or Convex origin. The desktop and loopback-web surfaces are untouched —
 * they simply do not configure a static root.
 *
 * The security headers are NOT restated here. `vp build` emits the exact header
 * set the app was built against into `dist/_headers` (see
 * apps/web/vite.config.ts), and this module reads that file. One source of
 * truth: a CSP change in the web app cannot drift out of sync with what the
 * host sends, because there is only one place it is written.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  clearedSessionCookie,
  readCookie,
  serializeSessionCookie,
  signSession,
  verifySession,
  type CookieAttributes,
} from "./session";

export interface WebSurfaceSession {
  secret: Parameters<typeof signSession>[0];
  cookieName: string;
  ttlMs: number;
  cookie: CookieAttributes;
  /** The subject a successful sign-in asserts. */
  subject: string;
  /** Shared sign-in secret. Compared in constant time. */
  password: string;
}

export interface WebSurfaceOptions {
  /** Directory holding the built app (`apps/web/dist`). */
  staticRoot: string;
  session: WebSurfaceSession;
  now?: () => number;
}

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

/**
 * Parse the `/*` block of a CloudFlare/Netlify-style `_headers` file.
 *
 * Only the catch-all block is honoured, because that is the only block the web
 * build emits. A file that grew per-path blocks would need this to grow with
 * it, and silently applying a `/admin` block to every path would be worse than
 * ignoring it.
 */
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

async function readSecurityHeaders(
  staticRoot: string,
): Promise<Array<[string, string]>> {
  const file = path.join(staticRoot, "_headers");
  let source: string;
  try {
    source = await readFile(await containedFile(staticRoot, file), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      // Fail closed. Serving the app without its CSP and cross-origin
      // isolation would also break DuckDB-WASM (which needs COOP/COEP for
      // SharedArrayBuffer), so a silent fallback would look like a subtle
      // runtime bug rather than a missing build artifact.
      throw new Error(
        `The built web app at ${staticRoot} has no _headers file. Run \`turbo build --filter=@dashframe/web\` so the security headers are emitted alongside it.`,
        { cause: error },
      );
    }
    throw error;
  }
  const headers = parseHeadersFile(source);
  if (headers.length === 0)
    throw new Error(`No catch-all header block found in ${file}`);
  return headers;
}

/**
 * Resolve a URL path to a file inside `root`, or `undefined` if it escapes.
 *
 * This lexical check rejects decoded traversal. Serving additionally checks
 * canonical filesystem paths to prevent symlinks escaping the built bundle.
 */
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

async function containedFile(root: string, candidate: string): Promise<string> {
  const canonical = await realpath(candidate);
  if (!canonical.startsWith(root + path.sep))
    throw new Error("Static file escapes the built bundle");
  return canonical;
}

function passwordMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

const LOGIN_STYLE = `:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#1c1b1a;--muted:#6b6a67;--line:#e3e2df;--card:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#16151a;--fg:#eceaf0;--muted:#9a97a3;--line:#2c2a33;--card:#1e1d24}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(22rem,calc(100vw - 2rem));background:var(--card);border-radius:14px;padding:1.75rem;box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.07)}
h1{margin:0 0 .25rem;font-size:1.125rem;letter-spacing:-.01em}
p{margin:0 0 1.25rem;color:var(--muted);font-size:.875rem}
label{display:block;font-size:.8125rem;font-weight:500;margin-bottom:.375rem}
input{width:100%;padding:.5rem .625rem;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px}
input:focus-visible{outline:2px solid #6366f1;outline-offset:1px}
button{width:100%;margin-top:1rem;padding:.5rem;font:inherit;font-weight:500;color:#fff;background:#4f46e5;border:0;border-radius:8px;cursor:pointer}
button:hover{background:#4338ca}
.error{margin:0 0 1rem;padding:.5rem .625rem;border-radius:8px;font-size:.8125rem;color:#b42318;background:#fee4e2}
@media(prefers-color-scheme:dark){.error{color:#fda29b;background:#3a1a17}}`;

function loginPage(message?: string): Response {
  const error = message ? `<p class="error" role="alert">${message}</p>` : "";
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · DashFrame</title><style>${LOGIN_STYLE}</style></head><body><main><h1>DashFrame</h1><p>This deployment is private.</p><form method="post" action="/login">${error}<label for="password">Access password</label><input id="password" name="password" type="password" autocomplete="current-password" autofocus required><button type="submit">Sign in</button></form></main></body></html>`;
  return new Response(body, {
    status: message ? 401 : 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      // The sign-in page loads nothing and posts only to this origin. It gets
      // its own minimal policy rather than the app's, which has to permit
      // wasm-eval and a CDN.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Throttle sign-in attempts.
 *
 * A single shared password on a public origin is exactly the shape brute force
 * likes. This is a fixed window over the whole endpoint rather than per client
 * address: a hosted deployment sits behind a proxy, so the address this process
 * sees is the proxy's, and a per-address counter would be both useless and a
 * memory leak. A global window is a blunt instrument that briefly locks out the
 * legitimate operator under attack, which is the right trade for a private
 * personal deployment.
 */
export class LoginThrottle {
  private windowStart = 0;
  private attempts = 0;
  constructor(
    private readonly limit = 10,
    private readonly windowMs = 60_000,
  ) {}
  check(now: number): boolean {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.attempts = 0;
    }
    this.attempts += 1;
    return this.attempts <= this.limit;
  }
  succeed(): void {
    this.attempts = 0;
  }
}

export interface WebSurface {
  /** True when the request carries a valid, unexpired session cookie. */
  isSignedIn(request: Request): boolean;
  handleLoginPage(request: Request): Response;
  handleLoginSubmit(request: Request): Promise<Response>;
  handleLogout(): Response;
  /** Serve a built file, or the SPA shell. Callers gate on `isSignedIn` first. */
  serve(request: Request): Promise<Response>;
}

export async function createWebSurface(
  options: WebSurfaceOptions,
): Promise<WebSurface> {
  const serve = await createStaticWebSurface(options.staticRoot);
  const now = options.now ?? (() => Date.now());
  const throttle = new LoginThrottle();
  const { session } = options;

  const isSignedIn = (request: Request) =>
    Boolean(
      verifySession(
        session.secret,
        readCookie(request.headers.get("cookie"), session.cookieName),
        now(),
      ),
    );

  const issue = (): string => {
    const issuedAt = now();
    return signSession(session.secret, {
      subject: session.subject,
      issuedAt,
      expiresAt: issuedAt + session.ttlMs,
    });
  };

  return {
    isSignedIn,
    handleLoginPage(request) {
      if (isSignedIn(request))
        return new Response(null, { status: 303, headers: { Location: "/" } });
      return loginPage();
    },
    async handleLoginSubmit(request) {
      if (!throttle.check(now()))
        return loginPage("Too many attempts. Wait a minute and try again.");
      let submitted: string;
      try {
        const form = await request.formData();
        const value = form.get("password");
        submitted = typeof value === "string" ? value : "";
      } catch {
        return loginPage("Could not read the sign-in form.");
      }
      if (!submitted || !passwordMatches(submitted, session.password))
        return loginPage("Incorrect password.");
      throttle.succeed();
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/",
          "Cache-Control": "no-store",
          "Set-Cookie": serializeSessionCookie(session.cookieName, issue(), {
            ...session.cookie,
            maxAgeSeconds: Math.floor(session.ttlMs / 1000),
          }),
        },
      });
    },
    handleLogout() {
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/login",
          "Cache-Control": "no-store",
          "Set-Cookie": clearedSessionCookie(
            session.cookieName,
            session.cookie,
          ),
        },
      });
    },
    serve,
  };
}

/** Serve public build assets; API authentication remains the owning host's responsibility. */
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
  const serve = async (request: Request): Promise<Response> => {
    const urlPath = new URL(request.url).pathname;
    const resolved = resolveStaticPath(root, urlPath);
    let file = resolved;
    if (file) {
      try {
        file = await containedFile(root, file);
        const stats = await stat(file);
        if (stats.isDirectory()) file = undefined;
      } catch {
        file = undefined;
      }
    }
    // Anything that is not a real file is the SPA shell: TanStack Router owns
    // client-side routing, so `/dashboards/abc` must return index.html rather
    // than 404. A missing file under /assets/ still returns the shell, which is
    // the standard SPA trade — a stale bundle reference reads as a router miss.
    const isShell = file === undefined;
    const target = file ?? index;
    const [body, stats] = await Promise.all([readFile(target), stat(target)]);
    const etag = `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
    const headers = new Headers(securityHeaders);
    headers.set(
      "Content-Type",
      CONTENT_TYPES.get(path.extname(target).toLowerCase()) ??
        "application/octet-stream",
    );
    headers.set("ETag", etag);
    // Hashed build output is immutable; the shell must never be cached or a
    // deploy would keep serving the previous bundle's asset references.
    let cacheControl = "public, max-age=3600";
    if (isShell) cacheControl = "no-cache";
    else if (urlPath.startsWith("/assets/"))
      cacheControl = "public, max-age=31536000, immutable";
    headers.set("Cache-Control", cacheControl);
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    return new Response(body, { status: 200, headers });
  };
  return serve;
}

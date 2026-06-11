/**
 * Minimal ambient typing for the build-time env flags this package reads.
 *
 * The shared app package is bundler-agnostic (Vite in both hosts today, but the
 * package itself doesn't depend on Vite). Rather than pull in `vite/client`, we
 * declare just the `import.meta.env.DEV` flag the perf instrumentation gates on.
 * Both Vite hosts populate it; non-Vite contexts leave it `undefined`, which the
 * code coerces with `Boolean(...)`.
 */
interface ImportMetaEnv {
  /** True in development builds, false in production. */
  readonly DEV?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

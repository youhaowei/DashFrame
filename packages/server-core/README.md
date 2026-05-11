# @dashframe/server-core

Runtime core for the DashFrame desktop process: project folder lifecycle,
artifact DB schema bootstrap, and server-side project metadata.

## Build Output Exception

Most DashFrame workspace packages export TypeScript source directly. This
package intentionally exports compiled `dist/*` artifacts because the Electron
main process bundles workspace packages as external dependencies, and Electron's
Node runtime cannot load the package's `.ts` entry point at runtime.

Run `bun run --filter @dashframe/server-core build` before launching or
packaging the desktop app. The root `typecheck` pipeline also depends on this
build so downstream desktop imports resolve from `dist/index.d.ts` in fresh
checkouts.

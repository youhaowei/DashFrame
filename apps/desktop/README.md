# Desktop build and unsigned packaging

Run `bun run setup` from the repository root on a fresh checkout, then explicitly
provision the backend for the build host:

```sh
bun --filter @dashframe/convex-local provision
bun run --cwd apps/desktop build
bun run --cwd apps/desktop package:dir
```

`build` verifies and stages the pinned Convex executable, license, and bundled
functions into `apps/desktop/dist/convex`, then builds main and preload. It fails
if the binary or license is missing; it never downloads a backend implicitly.
`DASHFRAME_CONVEX_BINARY` can select an explicitly provisioned binary, with its
verified `LICENSE.md` beside it. CI workers running this build must provision the
backend first, just like a fresh developer checkout.

`package:dir` runs that build, checks and builds the renderer with relative asset
URLs, and creates an unsigned application for the current host architecture in
`apps/desktop/dist/package`. Cross-platform packaging is rejected so a package
cannot accidentally ship the build host's backend executable.

The Electron application layout preserves `desktop/dist` and `renderer/dist`.
Convex lives separately at `process.resourcesPath/convex`; packaging checks that
the executable, license, function modules, renderer, preload, and Convex CLI are
present. Each staging run replaces the whole Convex resource tree, so removed
function modules and other stale files cannot carry over.

The directory package uses unpacked dependencies (`asar: false`) so the native
DuckDB addon and Convex CLI can execute from real paths. This command does not
sign, notarize, create installers, or publish. Signed distribution needs a
separate release pipeline; it must preserve the checksum-pinned backend bytes.

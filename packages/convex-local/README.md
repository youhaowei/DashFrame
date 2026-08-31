# Local Convex host

`startLocalConvex` starts the pinned official backend directly on loopback. It
creates private per-project instance credentials locally, deploys the application's
functions, and verifies both instance identity and `internal.host.runtimeReady`.
Only a URL and a host-only internal query/mutation client are returned. Never
serialize that client or the contents of `.convex/` into renderer IPC.

Provision the macOS Apple Silicon executable explicitly:

```sh
bun --filter @dashframe/convex-local provision
bun --filter @dashframe/convex-local test:runtime
```

Provisioning verifies the release archive, executable, and license SHA-256 values.
Startup does not download, register with the cloud, or upgrade existing state.
Ordinary tests omit binary integration; `test:runtime` requires the installed binary
and verifies real loopback listeners, mutation persistence, and process cleanup.

Always await `stop()`. An unexpected backend exit is exposed through `closed` and
the optional callback; it does not trigger an automatic fresh deployment. A host
SIGKILL or machine crash may leave an ownership lock and backend process. Stop the
recorded owner before manually removing `.convex/runtime.lock`. Never delete the
database or regenerate credentials to clear a startup error.

Desktop builds stage `apps/desktop/dist/convex` with `stage:convex`, then include it
as `resources/convex` outside `app.asar`. The host supplies those explicit paths.
The staged functions bundle workspace dependencies and retain the pinned Convex
package. No Node actions are supported by this application. Codesigning must not
alter the checksum-pinned backend bytes; signed distribution remains a separate
verification step.

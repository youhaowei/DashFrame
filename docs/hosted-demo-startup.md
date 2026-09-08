# Hosted demo startup

The hosted candidate uses the built browser app and a separate server entry:

```sh
sh scripts/with-hosted-volume-lock.sh bun apps/server/src/hosted.ts
```

Run from `/app` in the built Docker image, with a persistent volume attached.
The image's existing default command still starts the legacy local server;
override it with the command above when testing this candidate.

Configure these values on the host:

| Variable                           | Value                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `PORT`                             | Listening port supplied by the host                                             |
| `RAILWAY_VOLUME_MOUNT_PATH`        | Persistent volume mount                                                         |
| `DASHFRAME_PUBLIC_ORIGIN`          | Exact HTTPS browser origin, without a trailing slash                            |
| `DASHFRAME_CONVEX_DEPLOYMENT_URL`  | Convex Cloud deployment URL                                                     |
| `DASHFRAME_WORKOS_CLIENT_ID`       | Shared login application client ID                                              |
| `DASHFRAME_WORKOS_ISSUER`          | Issuer accepted by the WorkOS verifier                                          |
| `DASHFRAME_WORKOS_API_KEY`         | API key for that WorkOS environment                                             |
| `DASHFRAME_WORKOS_COOKIE_PASSWORD` | Session encryption password, at least 32 characters                             |
| `DASHFRAME_AUTH_ISSUER`            | HTTPS issuer trusted by the Convex deployment                                   |
| `DASHFRAME_AUTH_PRIVATE_KEY`       | RSA runtime signing key; alternatively use `DASHFRAME_AUTH_PRIVATE_KEY_FILE`    |
| `DASHFRAME_SECRET_KEY`             | Base64-encoded 32-byte vault key; alternatively use `DASHFRAME_SECRET_KEY_FILE` |

Allow `${DASHFRAME_PUBLIC_ORIGIN}/auth/callback` in the WorkOS application.
Configure Convex for hosted mode with the corresponding runtime public JWKS
and separate operator trust, as described in `hosted-admission-slice.md`.
Grant demo users admission through the operator interface. Keep operator
private keys off the public host.

`GET /health` reports process liveness. `GET /api/version` reports the Railway
commit when available. Neither proves that sign-in, workspace startup or data
queries work; exercise an admitted user through the browser for those checks.

The current query worker requires Linux with Landlock ABI 7. Successful local
route acceptance uses native DuckDB and does not establish that host capability.
Local CLI and desktop startup continue to use their existing entry points and
do not need these hosted settings.

# Hosted demo startup

The Docker image starts the built browser app and hosted server through:

```sh
sh scripts/start-railway.sh
```

Run from `/app` in the built Docker image, with a persistent volume attached.
This is the image default command; no Railway command override is needed.

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

## Agent connection

In the hosted app, open Access credentials and copy the MCP connection URL. Issue a named credential and configure your MCP client to send it as a Bearer token. The URL includes the admitted workspace: `https://dashframe.dev/workspaces/<workspace-id>/mcp`.

Hosted MCP is stateless HTTP. It does not use the local WebSocket endpoint. Each request verifies the credential and current workspace admission before opening query resources; revoking the credential denies subsequent requests. Local app connection details remain unchanged.

## Vault key rotation

To rotate the active vault key, set a new `DASHFRAME_SECRET_KEY`, retain the
previous value in `DASHFRAME_SECRET_KEY_PREVIOUS`, and restart the host. The
previous-key variable accepts a comma-separated list. Existing secrets remain
readable with retained keys; new secrets use the active key.

Rotation does not re-encrypt existing secrets. Keep their old keys until those
secrets have been rewritten or revoked and reissued. Removing an old key makes
secrets still encrypted with it unreadable. Keep the persistent volume attached
across restarts.

## Follow-up after the demo

Client cancellation discards that request's result without terminating the shared
workspace query engine. Accepted engine work stays bounded by its own operation
timeout. An engine-wide failure or CPU limit can still fail concurrent requests;
recovery creates a fresh catalog after the worker exits. Automatic query replay
and closing the short worker-exit retry window remain follow-up work.

Vault and credential handles are retained per admitted workspace for the host
process lifetime, independently of the eight active-workspace engine limit. Revisit
cache eviction when the admitted user population grows beyond the demo.

# @dashframe/assistant

Shared tools for DashFrame's external agent API and in-browser agent surface.

- `read/` provides privacy-aware artifact graph reads, the `GraphReader` port,
  the value privacy floor, and the command vocabulary guide.
- `tool.ts` provides typed tool handlers and TypeBox argument validation.
- `draft-commands.ts` exports the draft-safe command allowlist and credential
  argument fields used by the MCP draft path.

The `@dashframe/assistant/read/floor` subpath exposes the privacy floor to the
browser agent surface. The package does not run models or manage model-provider
credentials.

# MCP inline report visual proof

These screenshots show the DashFrame `render_data_frame` tool running in the
official MCP Apps v1.7.0 reference host against DashFrame's real Streamable HTTP
MCP route with a safe acceptance fixture.

- [Light theme](./light.png)
- [Dark theme](./dark.png)

The reference host completed the standard `ui/initialize`, tool result, resize,
and app-initiated tool call lifecycle. These images prove the standards-compliant
adapter in a real MCP Apps renderer; they are not presented as ChatGPT or Codex
Desktop screenshots. Codex CLI 0.147.0 separately exercised the server's
structured/text fallback because that host has no inline renderer.

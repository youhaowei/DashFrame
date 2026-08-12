# MCP inline report visual proof

These screenshots show the DashFrame `render_data_frame` tool running in the
official MCP Apps v1.7.0 reference host against DashFrame's real Streamable HTTP
MCP route with a safe acceptance fixture.

- [Light theme](./light.png)
- [Dark theme](./dark.png)

These images prove the adapter's visual output in a real MCP Apps renderer. The
same acceptance run separately observed the standard `ui/initialize`, tool
result, resize, and app-initiated tool call lifecycle in host/runtime logs. The
images are not presented as ChatGPT or Codex Desktop screenshots. Codex CLI
0.147.0 separately exercised the server's structured/text fallback because that
host has no inline renderer.

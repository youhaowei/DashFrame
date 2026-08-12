# MCP inline report visual proof

These screenshots show the DashFrame `render_data_frame` tool running in the
official MCP Apps v1.7.0 reference host against DashFrame's real Streamable HTTP
MCP route with a safe acceptance fixture.

- [Light theme](./light.png)
- [Dark theme](./dark.png)
- [Selected mock and browser comparison](./comparison.png)

The selected table-first view keeps the healthy state to the report title and a
single data card. Chart-only and mixed views remain available when requested;
stale state, errors, and paging controls appear only when relevant. The same
acceptance run observed the standard `ui/initialize`, tool result, resize, and
app-initiated `query_data_frame` paging lifecycle in host/runtime logs.

These images prove the adapter's visual output in a real standards-compatible
MCP Apps renderer. They are not presented as ChatGPT or Codex Desktop
screenshots. Codex CLI 0.147.0 separately exercised the server's structured and
text fallback because that host has no inline renderer.

# 0001: Official SDK, stdio first, stateless Streamable HTTP

## Status

Accepted

## Context

MCP clients such as Claude Desktop, VS Code, and Cursor launch local servers as child processes and
talk JSON-RPC over stdio. Remote deployments use the Streamable HTTP transport. Protocol details
(initialization, capability negotiation, schema conversion) change between specification revisions.

## Decision

Use the official `@modelcontextprotocol/sdk` (`McpServer`, `registerTool`, `registerResource`) and
make stdio the default transport. Offer Streamable HTTP behind `--http` in stateless mode: each POST
creates a fresh server and transport (`sessionIdGenerator: undefined`, JSON responses).

## Consequences

- Protocol upgrades come from the SDK rather than hand-written JSON-RPC.
- Stateless HTTP needs no session store and scales horizontally, which fits tools that keep no state
  between calls. Server-initiated notifications over GET are not supported (GET returns 405).
- Each HTTP request pays a small server construction cost (well under a millisecond).

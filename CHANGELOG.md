# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-01

### Added

- Model Context Protocol server built on the official `@modelcontextprotocol/sdk`, with stdio
  (default) and stateless Streamable HTTP transports.
- Tools: `tokenize`, `bm25_search`, `eval_compare`, `json_schema_validate`, `prompt_injection_scan`,
  each with a zod input schema, an output schema, structured results, and tool-level error reporting.
- Resources: `mltools://prices`, `mltools://docs/tools`, `mltools://config`, `mltools://metrics`.
- JSON configuration file, environment variables, and command line flags; filesystem access is off
  unless an allowlisted `documentRoot` is configured.
- Optional bearer token for the HTTP transport, `/healthz`, and Prometheus `/metrics`.
- Unit tests for every tool, an in-memory server test, an HTTP test, and an integration test that
  spawns the built server over stdio with the SDK client.

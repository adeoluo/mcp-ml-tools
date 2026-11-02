# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/adeoluo/mcp-ml-tools/security/advisories/new)
rather than a public issue. Include the version, the transport (stdio or HTTP), the configuration,
and steps to reproduce. You can expect an acknowledgement within a few days.

## Supported versions

Only the latest release receives fixes.

## Design summary

- Every tool is read-only and deterministic; no tool executes code, spawns processes, or makes
  network requests.
- Filesystem access is disabled by default. When `documentRoot` is configured, `bm25_search` can read
  only text files under that directory; paths are resolved with `realpath` and checked by path
  segment, and symbolic links inside the tree are skipped.
- The HTTP transport binds to `127.0.0.1` by default, supports a bearer token
  (`MCP_ML_TOOLS_HTTP_TOKEN`), compares it in constant time, and limits request bodies to 8 MiB.
- Logs go to standard error so they never corrupt the stdio protocol stream.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full analysis.

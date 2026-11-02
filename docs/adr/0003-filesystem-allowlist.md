# 0003: Filesystem access is off unless an allowlisted root is configured

## Status

Accepted

## Context

An MCP server runs with the user's permissions, and the model decides which arguments to send. A
prompt injection in a retrieved document could ask the model to call `bm25_search` on `~/.ssh` or
`/etc`.

## Decision

`bm25_search` reads from disk only when `documentRoot` is set (configuration file,
`MCP_ML_TOOLS_DOCUMENT_ROOT`, or `--document-root`). The requested directory is resolved against the
root, both are passed through `realpath`, and containment is checked by path segments
(`path.relative`), not string prefixes. Symbolic links and hidden entries inside the tree are skipped.
Only allowlisted extensions are read, with limits on file count and file size. Each file is opened
once (with `O_NOFOLLOW` where the platform supports it) and its size is checked and its content read
through that same handle, so the file cannot be swapped between the check and the read.

## Consequences

- The default installation cannot read any file.
- Symbolic links inside the root are never followed, even when they point to another location inside
  the root. This is deliberately conservative.

# Threat model

## Assets

- Files on the machine running the server.
- Secrets in the environment (for example `MCP_ML_TOOLS_HTTP_TOKEN`).
- Availability of the MCP client session.

## Trust boundaries

1. **Model-generated tool arguments.** The model chooses arguments, and the model may be steered by
   injected text. Arguments are treated as untrusted.
2. **Network clients** (HTTP transport only).
3. **Configuration** written by the local user, which is trusted.

## Threats and mitigations

| Threat                                                        | Mitigation                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path traversal (`../../etc`) or absolute paths in `directory` | Filesystem access off by default; `realpath` plus segment-wise containment check against `documentRoot`                                                                 |
| Symbolic link escape from the root                            | Symbolic links inside the tree are skipped; the requested directory itself is resolved with `realpath` before the check                                                 |
| Reading huge or binary files                                  | Extension allowlist, `maxFiles`, `maxFileBytes`                                                                                                                         |
| Denial of service through large inputs                        | zod limits on text length (2,000,000 characters), array sizes, `topK`, and bootstrap samples; `n * bootstrapSamples` capped at 200,000,000; HTTP bodies capped at 8 MiB |
| Regular expression backtracking in `prompt_injection_scan`    | Rules avoid nested unbounded quantifiers; the benchmark scans 60,000 characters in a few milliseconds                                                                   |
| Unauthenticated network access                                | HTTP binds to `127.0.0.1` by default; optional bearer token compared in constant time; a warning when binding to a non-loopback address without a token                 |
| DNS rebinding against the local HTTP port                     | When bound to loopback, `/mcp` rejects requests whose `Host` header is not `localhost`, `127.0.0.1`, or `[::1]` (403); a token adds a second check                      |
| Leaking secrets through resources                             | `mltools://config` omits the token and reports only whether one is required                                                                                             |
| Secrets echoed back by the scanner                            | Secret excerpts are masked (`AKIA****LE`)                                                                                                                               |
| Protocol corruption over stdio                                | All logging goes to standard error                                                                                                                                      |

## Out of scope and limitations

- `prompt_injection_scan` is a rule-based screen. Paraphrases, translations, and encodings can evade
  it. It reduces risk; it does not replace model-side defenses or least-privilege tool design.
- PII detection targets common formats (email, North American and E.164 phone numbers, United States
  Social Security numbers, Luhn-valid card numbers, IPv4 addresses) and will miss others.

export const TOOL_DOCUMENTATION = `# mcp-ml-tools: tool reference

All tools are deterministic, read-only, and return both a JSON text block and \`structuredContent\`.
Invalid input is reported as a tool error (\`isError: true\`) with a message that names the problem.

## tokenize
Counts tokens with the bundled byte-level BPE (exact for that vocabulary) and estimates token counts
and cost for every model in the price table (character-based approximation).

- \`text\` (string, required)
- \`models\` (string[]): restrict estimates to these price table entries
- \`expectedOutputTokens\` (integer, default 0): adds output cost
- \`includeTokenIds\` (boolean, default true), \`maxTokenIds\` (integer, default 2000)

Example: \`{"text": "Hello, world!", "models": ["gpt-4o"], "expectedOutputTokens": 200}\`

## bm25_search
Okapi BM25 (k1 = 1.2, b = 0.75 by default, Lucene inverse document frequency) over inline documents
and/or text files under the configured \`documentRoot\`. Returns rank, id, score, matched terms, snippet.

- \`query\` (string, required)
- \`documents\` ({id, text}[]): inline documents
- \`directory\` (string): path relative to \`documentRoot\`; requires filesystem access to be configured
- \`topK\` (integer, default 5), \`k1\`, \`b\`

Example: \`{"query": "paired bootstrap", "documents": [{"id": "a", "text": "..."}], "topK": 3}\`

## eval_compare
Paired comparison of per-example scores from model A and model B.

- \`scoresA\`, \`scoresB\` (number[], same length, at least 2)
- \`bootstrapSamples\` (integer, default 10000), \`confidenceLevel\` (default 0.95), \`seed\` (default 0)

Returns mean(B) - mean(A), its standard error, a percentile bootstrap confidence interval, a two-sided
bootstrap p-value (resampling the centered differences), win/tie counts, and McNemar's test when all
scores are 0 or 1 (exact binomial p-value recommended when fewer than 25 discordant pairs).

## json_schema_validate
Validates \`document\` (parsed JSON) or \`documentText\` (raw text, optionally in a Markdown code fence)
against \`schema\` with Ajv (all errors, formats enabled). Errors carry a JSON Pointer \`path\` (for
\`required\` and \`additionalProperties\` errors this points at the missing or extra property), a
\`jsonPath\`, the failing \`keyword\`, and the \`schemaPath\`. Parse failures report line and column.

## prompt_injection_scan
Rule-based screening for prompt injection, exfiltration, hidden characters, secrets, and personal
information. Each finding has a rule id, category, weight, and \`[start, end)\` span in UTF-16 code
units. \`riskScore = 1 - product(1 - weight)\` over distinct matched rules. Set \`redact: true\` to get
\`redactedText\` with PII and secrets replaced by labels such as \`[EMAIL]\`.

## Resources
- \`mltools://prices\`: the active price table
- \`mltools://docs/tools\`: this document
- \`mltools://config\`: the effective configuration (no secrets)
- \`mltools://metrics\`: per-tool call counts and latency
`;

# Benchmarks

Reproduce with `npm run benchmark` (it builds first, then runs `scripts/benchmark.mjs`). Inputs are
synthetic and seeded; numbers are the mean of a few repetitions after one warm-up call, measured
in-process (no MCP transport overhead).

Node v26.12.1, Apple M1, darwin arm64:

| Operation                                                        | Mean latency (ms) |
| ---------------------------------------------------------------- | ----------------: |
| tokenize: 100,000 characters (built-in BPE + 7 estimates)        |              3.04 |
| bm25_search: index 2,000 documents (120 words each)              |             69.54 |
| bm25_search: query over the 2,000-document index                 |              1.07 |
| eval_compare: n = 1,000 binary, 10,000 bootstrap samples         |            124.96 |
| json_schema_validate: 1,000-item array (includes schema compile) |              4.78 |
| prompt_injection_scan: about 60,000 characters, all rules        |              2.48 |

## Reading these numbers

- The tokenize input repeats a 37-word vocabulary, so the encoder's per-word cache is hit almost
  every time. Natural text with many distinct words is slower; it is still linear in input length.
- `bm25_search` rebuilds its index on every call (tools are stateless). For a 2,000-document corpus
  that costs about 45 ms per call; the query itself is about 1 ms.
- `eval_compare` cost grows with `n * bootstrapSamples`; the server caps that product at
  200,000,000 to bound worst-case latency.
- These are single-machine measurements for sizing, not comparisons against other tools.

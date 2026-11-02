# 0002: A small built-in byte-level BPE instead of provider tokenizers

## Status

Accepted

## Context

Exact counts for proprietary models need each provider's tokenizer. Bundling several production
vocabularies adds megabytes and still cannot cover closed tokenizers.

## Decision

Ship a byte-level BPE implemented in `src/tools/bpe.ts` (GPT-2 style pre-tokenization, merges applied
by rank) with a vocabulary trained on a small original corpus in `src/tools/bpe-corpus.ts`. Training
is deterministic (ties broken by the smallest pair) and a test regenerates the merges and compares
them with the committed table. Per-model counts are explicit approximations: characters divided by a
documented characters-per-token ratio from the price table.

## Consequences

- No tokenizer dependency; the encoder is lossless for any Unicode input.
- The bundled vocabulary is small (682 tokens: 256 bytes plus 426 merges, because training stops
  when no pair occurs twice), so its counts are higher than production tokenizers. The tool output
  says this in its `notes` field.
- Users who need exact provider counts should use the provider's tokenizer or counting endpoint;
  the price table and ratios can be tuned in the configuration file.

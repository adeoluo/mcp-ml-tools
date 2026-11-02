/**
 * Default model price table. Prices are United States dollars per one million tokens and were copied
 * from public provider pricing pages at the time of writing; providers change prices, so treat these
 * as illustrative defaults and override them in the configuration file for real budgeting.
 *
 * `charactersPerToken` is a heuristic ratio for English prose used to approximate token counts for
 * model families whose tokenizers are not bundled. Code, numbers, and non-English text differ.
 */
export interface ModelPrice {
  model: string;
  provider: string;
  inputPerMillion: number;
  outputPerMillion: number;
  charactersPerToken: number;
  tokenizerNote: string;
}

export const PRICE_TABLE_AS_OF = "2026-11-01";

export const DEFAULT_PRICES: readonly ModelPrice[] = [
  {
    model: "gpt-4o",
    provider: "openai",
    inputPerMillion: 2.5,
    outputPerMillion: 10,
    charactersPerToken: 4.0,
    tokenizerNote: "o200k_base byte-level BPE; approximated from character count",
  },
  {
    model: "gpt-4o-mini",
    provider: "openai",
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    charactersPerToken: 4.0,
    tokenizerNote: "o200k_base byte-level BPE; approximated from character count",
  },
  {
    model: "claude-sonnet-4",
    provider: "anthropic",
    inputPerMillion: 3,
    outputPerMillion: 15,
    charactersPerToken: 3.5,
    tokenizerNote: "proprietary tokenizer; approximated from character count",
  },
  {
    model: "claude-haiku-3.5",
    provider: "anthropic",
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    charactersPerToken: 3.5,
    tokenizerNote: "proprietary tokenizer; approximated from character count",
  },
  {
    model: "claude-opus-4",
    provider: "anthropic",
    inputPerMillion: 15,
    outputPerMillion: 75,
    charactersPerToken: 3.5,
    tokenizerNote: "proprietary tokenizer; approximated from character count",
  },
  {
    model: "gemini-1.5-pro",
    provider: "google",
    inputPerMillion: 1.25,
    outputPerMillion: 5,
    charactersPerToken: 4.0,
    tokenizerNote: "SentencePiece tokenizer; approximated from character count",
  },
  {
    model: "llama-3.1-70b",
    provider: "meta (hosted, price varies by host)",
    inputPerMillion: 0.88,
    outputPerMillion: 0.88,
    charactersPerToken: 3.8,
    tokenizerNote: "128k byte-level BPE; approximated from character count",
  },
];

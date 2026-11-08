/**
 * Default model price table. Prices are United States dollars per one million tokens and were copied
 * from public provider pricing pages at the time of writing; providers change prices, so treat these
 * as illustrative defaults and override them in the configuration file for real budgeting.
 *
 * Sources, checked 2026-11-08: the OpenAI, Anthropic and Gemini API pricing pages (standard tier, short
 * context) and the Together AI serverless price list for the open-weight models. Claude Haiku 5.5 is the
 * price for prompts up to 100,000 tokens. The Gemini rows are introductory prices that double on
 * 2026-12-01 (Gemini 4 Argon) and 2027-01-01 (Gemini 3.8 Flash).
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

export const PRICE_TABLE_AS_OF = "2026-11-08";

export const DEFAULT_PRICES: readonly ModelPrice[] = [
  {
    model: "gpt-6-astra",
    provider: "openai",
    inputPerMillion: 10,
    outputPerMillion: 50,
    charactersPerToken: 4.0,
    tokenizerNote: "OpenAI tokenizer; approximated from character count",
  },
  {
    model: "gpt-6.1-sol",
    provider: "openai",
    inputPerMillion: 2,
    outputPerMillion: 10,
    charactersPerToken: 4.0,
    tokenizerNote: "OpenAI tokenizer; approximated from character count",
  },
  {
    model: "gpt-6-luna",
    provider: "openai",
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    charactersPerToken: 4.0,
    tokenizerNote: "OpenAI tokenizer; approximated from character count",
  },
  {
    model: "claude-opus-5.5",
    provider: "anthropic",
    inputPerMillion: 4,
    outputPerMillion: 20,
    charactersPerToken: 3.5,
    tokenizerNote: "proprietary tokenizer; approximated from character count",
  },
  {
    model: "claude-sonnet-5.5",
    provider: "anthropic",
    inputPerMillion: 2,
    outputPerMillion: 10,
    charactersPerToken: 3.5,
    tokenizerNote: "proprietary tokenizer; approximated from character count",
  },
  {
    model: "claude-haiku-5.5",
    provider: "anthropic",
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    charactersPerToken: 3.5,
    tokenizerNote:
      "proprietary tokenizer; approximated from character count; prompts up to 100,000 tokens",
  },
  {
    model: "gemini-4-argon",
    provider: "google",
    inputPerMillion: 2,
    outputPerMillion: 10,
    charactersPerToken: 4.0,
    tokenizerNote: "Gemini tokenizer; approximated from character count; introductory price",
  },
  {
    model: "gemini-3.8-flash",
    provider: "google",
    inputPerMillion: 0.75,
    outputPerMillion: 3.75,
    charactersPerToken: 4.0,
    tokenizerNote: "Gemini tokenizer; approximated from character count; introductory price",
  },
  {
    model: "gpt-oss-120b",
    provider: "together (open weights, price varies by host)",
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    charactersPerToken: 4.0,
    tokenizerNote: "o200k_harmony byte-level BPE; approximated from character count",
  },
  {
    model: "deepseek-v4.1-flash",
    provider: "together (open weights, price varies by host)",
    inputPerMillion: 0.3,
    outputPerMillion: 1.2,
    charactersPerToken: 3.8,
    tokenizerNote: "byte-level BPE; approximated from character count",
  },
];

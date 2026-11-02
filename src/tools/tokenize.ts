import { BpeTokenizer } from "./bpe.js";
import { BPE_MERGES } from "./bpe-merges.js";
import type { ModelPrice } from "../prices.js";
import { ToolInputError } from "../errors.js";

let sharedTokenizer: BpeTokenizer | undefined;

export function builtInTokenizer(): BpeTokenizer {
  sharedTokenizer ??= new BpeTokenizer(BPE_MERGES);
  return sharedTokenizer;
}

export interface TokenizeOptions {
  text: string;
  models?: string[] | undefined;
  expectedOutputTokens?: number | undefined;
  includeTokenIds?: boolean | undefined;
  maxTokenIds?: number | undefined;
}

export interface ModelEstimate {
  model: string;
  provider: string;
  approximateInputTokens: number;
  expectedOutputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  method: string;
}

export interface TokenizeResult {
  characters: number;
  bytes: number;
  builtInBpe: {
    tokenCount: number;
    vocabularySize: number;
    bytesPerToken: number;
    tokenIds?: number[];
    tokenStrings?: string[];
    tokenIdsTruncated: boolean;
  };
  estimates: ModelEstimate[];
  notes: string[];
}

const encoder = new TextEncoder();

function roundUsd(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function tokenize(options: TokenizeOptions, prices: readonly ModelPrice[]): TokenizeResult {
  const tokenizer = builtInTokenizer();
  const ids = tokenizer.encode(options.text);
  const bytes = encoder.encode(options.text).length;
  const characters = Array.from(options.text).length;
  const includeIds = options.includeTokenIds ?? true;
  const maxIds = options.maxTokenIds ?? 2000;
  const outputTokens = options.expectedOutputTokens ?? 0;

  let selected: readonly ModelPrice[] = prices;
  if (options.models !== undefined && options.models.length > 0) {
    const known = new Map(prices.map((price) => [price.model, price]));
    const unknown = options.models.filter((model) => !known.has(model));
    if (unknown.length > 0) {
      throw new ToolInputError(
        `unknown model(s): ${unknown.join(", ")}. Known models: ${[...known.keys()].join(", ")}`,
      );
    }
    selected = options.models.map((model) => known.get(model) as ModelPrice);
  }

  const estimates = selected.map((price): ModelEstimate => {
    const approximateInputTokens =
      characters === 0 ? 0 : Math.max(1, Math.ceil(characters / price.charactersPerToken));
    const inputCostUsd = (approximateInputTokens / 1e6) * price.inputPerMillion;
    const outputCostUsd = (outputTokens / 1e6) * price.outputPerMillion;
    return {
      model: price.model,
      provider: price.provider,
      approximateInputTokens,
      expectedOutputTokens: outputTokens,
      inputCostUsd: roundUsd(inputCostUsd),
      outputCostUsd: roundUsd(outputCostUsd),
      totalCostUsd: roundUsd(inputCostUsd + outputCostUsd),
      method: `ceil(characters / ${price.charactersPerToken}); ${price.tokenizerNote}`,
    };
  });

  const shownIds = ids.slice(0, maxIds);
  const builtInBpe: TokenizeResult["builtInBpe"] = {
    tokenCount: ids.length,
    vocabularySize: tokenizer.vocabularySize,
    bytesPerToken: ids.length === 0 ? 0 : Math.round((bytes / ids.length) * 1000) / 1000,
    tokenIdsTruncated: includeIds && ids.length > maxIds,
  };
  if (includeIds) {
    builtInBpe.tokenIds = shownIds;
    builtInBpe.tokenStrings = shownIds.map((id) => tokenizer.tokenText(id));
  }

  return {
    characters,
    bytes,
    builtInBpe,
    estimates,
    notes: [
      `builtInBpe counts are exact for the bundled ${tokenizer.vocabularySize}-entry byte-level BPE ` +
        "vocabulary, which is much smaller than production vocabularies and so produces more tokens.",
      "Per-model token counts are approximations from character counts, not the providers' tokenizers.",
      "Prices come from the configured price table (see the mltools://prices resource).",
    ],
  };
}

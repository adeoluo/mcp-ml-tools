import { describe, expect, it } from "vitest";
import { ToolInputError } from "../src/errors.js";
import { DEFAULT_PRICES } from "../src/prices.js";
import { builtInTokenizer, tokenize } from "../src/tools/tokenize.js";

describe("tokenize tool", () => {
  it("returns exact built-in counts that match the tokenizer", () => {
    const text = "The model reads a prompt and predicts the next token.";
    const result = tokenize({ text }, DEFAULT_PRICES);
    expect(result.builtInBpe.tokenCount).toBe(builtInTokenizer().encode(text).length);
    expect(result.builtInBpe.tokenIds).toHaveLength(result.builtInBpe.tokenCount);
    expect(result.builtInBpe.tokenStrings?.join("")).toBe(text);
    expect(result.characters).toBe(text.length);
    expect(result.estimates).toHaveLength(DEFAULT_PRICES.length);
  });

  it("computes approximate tokens and cost from the price table", () => {
    const text = "a".repeat(400);
    const [estimate] = tokenize(
      { text, models: ["gpt-4o"], expectedOutputTokens: 1000 },
      DEFAULT_PRICES,
    ).estimates;
    expect(estimate?.approximateInputTokens).toBe(100);
    expect(estimate?.inputCostUsd).toBeCloseTo(0.00025, 10);
    expect(estimate?.outputCostUsd).toBeCloseTo(0.01, 10);
    expect(estimate?.totalCostUsd).toBeCloseTo(0.01025, 10);
  });

  it("counts characters by code point and bytes as UTF-8", () => {
    const result = tokenize({ text: "é🙂" }, DEFAULT_PRICES);
    expect(result.characters).toBe(2);
    expect(result.bytes).toBe(6);
  });

  it("truncates or omits token ids on request", () => {
    const text = "token ".repeat(50);
    const truncated = tokenize({ text, maxTokenIds: 5 }, DEFAULT_PRICES);
    expect(truncated.builtInBpe.tokenIds).toHaveLength(5);
    expect(truncated.builtInBpe.tokenIdsTruncated).toBe(true);
    const omitted = tokenize({ text, includeTokenIds: false }, DEFAULT_PRICES);
    expect(omitted.builtInBpe.tokenIds).toBeUndefined();
    expect(omitted.builtInBpe.tokenIdsTruncated).toBe(false);
  });

  it("handles empty text", () => {
    const result = tokenize({ text: "" }, DEFAULT_PRICES);
    expect(result.builtInBpe.tokenCount).toBe(0);
    expect(result.builtInBpe.bytesPerToken).toBe(0);
    expect(result.estimates.every((estimate) => estimate.approximateInputTokens === 0)).toBe(true);
  });

  it("rejects unknown models with the list of known ones", () => {
    expect(() => tokenize({ text: "x", models: ["not-a-model"] }, DEFAULT_PRICES)).toThrow(
      ToolInputError,
    );
    expect(() => tokenize({ text: "x", models: ["not-a-model"] }, DEFAULT_PRICES)).toThrow(
      /gpt-4o/,
    );
  });
});

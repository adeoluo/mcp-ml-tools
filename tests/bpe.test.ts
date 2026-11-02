import { describe, expect, it } from "vitest";
import { BpeTokenizer, pretokenize, trainBpe } from "../src/tools/bpe.js";
import { BPE_TRAINING_CORPUS as BPE_CORPUS_FOR_TEST } from "../src/tools/bpe-corpus.js";
import { BPE_MERGES } from "../src/tools/bpe-merges.js";
import { MERGE_COUNT } from "../src/tools/bpe-settings.js";
import { mulberry32 } from "../src/random.js";

/** The GPT-2 pre-tokenization regular expression that the linear scanner reimplements. */
const REFERENCE_PATTERN =
  /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

describe("byte-level BPE", () => {
  const tokenizer = new BpeTokenizer(BPE_MERGES);

  it("reproduces the committed merge table from the training corpus", () => {
    expect(trainBpe(BPE_CORPUS_FOR_TEST, MERGE_COUNT)).toEqual(BPE_MERGES);
  });

  it.each([
    "",
    "Hello, world!",
    "The model predicts the next token.",
    "  leading and trailing spaces  \n\n",
    "Unicode: 日本語, emoji 🙂👩‍💻, accents café naïve",
    "const x = {a: 1, b: [2, 3]}; // code",
    "\u200Bzero\u200Bwidth\uFEFF",
  ])("round-trips %j losslessly", (text) => {
    expect(tokenizer.decode(tokenizer.encode(text))).toBe(text);
  });

  it("compresses common corpus words into single tokens", () => {
    expect(tokenizer.encode(" the")).toHaveLength(1);
    expect(tokenizer.encode(" model")).toHaveLength(1);
    expect(tokenizer.encode("the model").length).toBeLessThan("the model".length);
  });

  it("assigns ids below the vocabulary size and falls back to raw bytes", () => {
    const ids = tokenizer.encode("zqxj 🙂");
    expect(ids.every((id) => id >= 0 && id < tokenizer.vocabularySize)).toBe(true);
    expect(tokenizer.vocabularySize).toBe(256 + BPE_MERGES.length);
  });

  it("is deterministic and uses its cache consistently", () => {
    const text = "repeat repeat repeat";
    expect(tokenizer.encode(text)).toEqual(tokenizer.encode(text));
  });

  it("rejects unknown token ids and malformed merges", () => {
    expect(() => tokenizer.decode([999_999])).toThrow(RangeError);
    expect(() => new BpeTokenizer([[1, 5000]])).toThrow(/unknown token id/);
  });

  it("learns the most frequent pair first with deterministic tie breaking", () => {
    const merges = trainBpe("ab ab ab cd cd", 10);
    expect(merges[0]).toEqual([97, 98]);
    expect(trainBpe("abc", 10)).toEqual([]);
  });

  it("clears its chunk cache once the limit is reached", () => {
    const small = new BpeTokenizer(BPE_MERGES);
    const words = Array.from({ length: 10_050 }, (_, index) => `w${index}`).join(" ");
    expect(small.decode(small.encode(words))).toBe(words);
  });

  it("pre-tokenizes exactly like the GPT-2 regular expression", () => {
    const alphabet = [
      "a",
      "Z",
      "é",
      "日",
      "7",
      "٣",
      " ",
      " ",
      "  ",
      "\n",
      "\t",
      "'",
      "'s",
      "'ll",
      "'re",
      "!",
      "?.",
      "🙂",
      "\u00A0",
      "\u2003",
      "-",
      "_",
    ];
    const random = mulberry32(11);
    for (let trial = 0; trial < 3000; trial++) {
      const length = Math.floor(random() * 25);
      let text = "";
      for (let i = 0; i < length; i++) text += alphabet[Math.floor(random() * alphabet.length)];
      expect(pretokenize(text), JSON.stringify(text)).toEqual(text.match(REFERENCE_PATTERN) ?? []);
    }
  });

  it("pre-tokenizes long whitespace runs in linear time", () => {
    const text = `${" ".repeat(200_000)}x${"\n".repeat(200_000)}`;
    const started = performance.now();
    const chunks = pretokenize(text);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(chunks.join("")).toBe(text);
  });

  it("splits text GPT-2 style", () => {
    expect(pretokenize("I'll test it, 42 times!")).toEqual([
      "I",
      "'ll",
      " test",
      " it",
      ",",
      " 42",
      " times",
      "!",
    ]);
  });
});

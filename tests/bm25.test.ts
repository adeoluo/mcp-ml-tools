import { describe, expect, it } from "vitest";
import { Bm25Index, analyze } from "../src/tools/bm25.js";

const corpus = [
  { id: "d1", text: "Cats chase mice." },
  { id: "d2", text: "Dogs chase cats and cats sleep." },
  { id: "d3", text: "Birds sing." },
];

describe("BM25", () => {
  it("analyzes text into lowercase terms with offsets and drops stopwords", () => {
    expect(analyze("The Cat and THE dog")).toEqual([
      { term: "cat", start: 4, end: 7 },
      { term: "dog", start: 16, end: 19 },
    ]);
  });

  it("matches hand-computed Okapi BM25 scores", () => {
    const index = new Bm25Index(corpus);
    const idf = Math.log(1 + (3 - 2 + 0.5) / (2 + 0.5));
    const average = 10 / 3;
    const expected = (tf: number, length: number) =>
      (idf * (tf * 2.2)) / (tf + 1.2 * (0.25 + (0.75 * length) / average));
    const hits = index.search("cats", 10);
    expect(hits.map((hit) => hit.id)).toEqual(["d2", "d1"]);
    expect(hits[0]?.score).toBeCloseTo(expected(2, 5), 5);
    expect(hits[1]?.score).toBeCloseTo(expected(1, 3), 5);
    expect(index.inverseDocumentFrequency("cats")).toBeCloseTo(idf, 12);
    expect(index.size).toBe(3);
    expect(index.vocabularySize).toBe(7);
  });

  it("ranks the document that covers more rare query terms first", () => {
    const index = new Bm25Index([
      { id: "retrieval", text: "BM25 is a lexical retrieval function used by search engines." },
      {
        id: "evaluation",
        text: "A paired bootstrap estimates a confidence interval for accuracy.",
      },
      {
        id: "both",
        text: "Use BM25 retrieval, then a paired bootstrap to compare retrieval systems.",
      },
      { id: "tokenizer", text: "Byte pair encoding merges frequent pairs of bytes." },
    ]);
    const hits = index.search("bm25 bootstrap", 4);
    expect(hits[0]?.id).toBe("both");
    expect(hits[0]?.matchedTerms).toEqual(["bm25", "bootstrap"]);
    expect(hits.map((hit) => hit.id)).not.toContain("tokenizer");
    expect(hits.map((hit) => hit.rank)).toEqual([1, 2, 3]);
  });

  it("returns no hits for stopword-only or unmatched queries and respects topK", () => {
    const index = new Bm25Index(corpus);
    expect(index.search("the and of", 5)).toEqual([]);
    expect(index.search("zebra", 5)).toEqual([]);
    expect(index.search("chase", 1)).toHaveLength(1);
  });

  it("disables length normalization when b = 0", () => {
    const index = new Bm25Index(
      [
        { id: "short", text: "apple" },
        { id: "long", text: "apple banana cherry date elderberry fig grape" },
      ],
      { k1: 1.2, b: 0 },
    );
    const [first, second] = index.search("apple", 2);
    expect(first?.score).toBeCloseTo(second?.score ?? Number.NaN, 12);
    expect(first?.id).toBe("long");
  });

  it("builds snippets around the first matched term", () => {
    const text = `${"filler words here. ".repeat(30)}The needle appears here. ${"more filler text. ".repeat(30)}`;
    const [hit] = new Bm25Index([{ id: "x", text }]).search("needle", 1, 60);
    expect(hit?.snippet).toContain("needle");
    expect(hit?.snippet.startsWith("...")).toBe(true);
    expect(hit?.snippet.endsWith("...")).toBe(true);
  });

  it("rejects duplicate ids and handles an empty index", () => {
    expect(
      () =>
        new Bm25Index([
          { id: "a", text: "x" },
          { id: "a", text: "y" },
        ]),
    ).toThrow(/duplicate/);
    expect(new Bm25Index([]).search("anything", 3)).toEqual([]);
  });
});

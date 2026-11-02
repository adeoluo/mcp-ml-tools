import { ToolInputError } from "../errors.js";

export interface Document {
  id: string;
  text: string;
}

export interface Bm25Parameters {
  k1: number;
  b: number;
}

export interface SearchHit {
  rank: number;
  id: string;
  score: number;
  matchedTerms: string[];
  snippet: string;
}

interface Token {
  term: string;
  start: number;
  end: number;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have he her his i if in into is it its of on or " +
    "our she so that the their them then there these they this to was we were what when which " +
    "who will with you your"
  ).split(" "),
);

const TERM_PATTERN = /[\p{L}\p{N}]+/gu;

export function analyze(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TERM_PATTERN)) {
    const term = match[0].toLowerCase();
    if (!STOPWORDS.has(term)) {
      tokens.push({ term, start: match.index, end: match.index + match[0].length });
    }
  }
  return tokens;
}

interface IndexedDocument {
  document: Document;
  tokens: Token[];
  termFrequencies: Map<string, number>;
  length: number;
}

/** Okapi BM25 with the non-negative Lucene inverse document frequency. */
export class Bm25Index {
  private readonly documents: IndexedDocument[] = [];
  private readonly documentFrequencies = new Map<string, number>();
  private readonly averageLength: number;

  constructor(
    documents: readonly Document[],
    private readonly parameters: Bm25Parameters = { k1: 1.2, b: 0.75 },
  ) {
    const seen = new Set<string>();
    let totalLength = 0;
    for (const document of documents) {
      if (seen.has(document.id)) {
        throw new ToolInputError(`duplicate document id: ${document.id}`);
      }
      seen.add(document.id);
      const tokens = analyze(document.text);
      const termFrequencies = new Map<string, number>();
      for (const token of tokens) {
        termFrequencies.set(token.term, (termFrequencies.get(token.term) ?? 0) + 1);
      }
      for (const term of termFrequencies.keys()) {
        this.documentFrequencies.set(term, (this.documentFrequencies.get(term) ?? 0) + 1);
      }
      this.documents.push({ document, tokens, termFrequencies, length: tokens.length });
      totalLength += tokens.length;
    }
    this.averageLength = documents.length === 0 ? 0 : totalLength / documents.length;
  }

  get size(): number {
    return this.documents.length;
  }

  get vocabularySize(): number {
    return this.documentFrequencies.size;
  }

  inverseDocumentFrequency(term: string): number {
    const n = this.documents.length;
    const df = this.documentFrequencies.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  score(queryTerms: readonly string[], indexed: IndexedDocument): number {
    const { k1, b } = this.parameters;
    const lengthRatio = this.averageLength === 0 ? 0 : indexed.length / this.averageLength;
    let total = 0;
    for (const term of queryTerms) {
      const frequency = indexed.termFrequencies.get(term) ?? 0;
      if (frequency === 0) continue;
      const numerator = frequency * (k1 + 1);
      const denominator = frequency + k1 * (1 - b + b * lengthRatio);
      total += this.inverseDocumentFrequency(term) * (numerator / denominator);
    }
    return total;
  }

  search(query: string, topK: number, snippetLength = 200): SearchHit[] {
    const queryTerms = [...new Set(analyze(query).map((token) => token.term))];
    if (queryTerms.length === 0) {
      return [];
    }
    const scored = this.documents
      .map((indexed) => ({ indexed, score: this.score(queryTerms, indexed) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (x, y) => y.score - x.score || x.indexed.document.id.localeCompare(y.indexed.document.id),
      )
      .slice(0, topK);
    return scored.map(({ indexed, score }, index) => {
      const matchedTerms = queryTerms.filter((term) => indexed.termFrequencies.has(term));
      return {
        rank: index + 1,
        id: indexed.document.id,
        score: Math.round(score * 1e6) / 1e6,
        matchedTerms,
        snippet: makeSnippet(indexed, new Set(matchedTerms), snippetLength),
      };
    });
  }
}

function makeSnippet(indexed: IndexedDocument, terms: Set<string>, length: number): string {
  const text = indexed.document.text;
  const first = indexed.tokens.find((token) => terms.has(token.term));
  const center = first === undefined ? 0 : first.start;
  let start = Math.max(0, center - Math.floor(length / 3));
  const end = Math.min(text.length, start + length);
  start = Math.max(0, end - length);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${body}${end < text.length ? "..." : ""}`;
}

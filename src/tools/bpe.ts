/**
 * Byte-level byte pair encoding (BPE): a small, dependency-free implementation of the scheme used by
 * GPT-2 style tokenizers. Token ids 0 to 255 are raw bytes; id 256 + i is produced by merge i.
 */

export type Merge = readonly [number, number];

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

const enum Kind {
  Letter,
  Number,
  Space,
  Other,
}

const LETTER = /\p{L}/u;
const NUMBER = /\p{N}/u;
const WHITESPACE = /\s/u;

function kindOf(character: string): Kind {
  if (LETTER.test(character)) return Kind.Letter;
  if (NUMBER.test(character)) return Kind.Number;
  if (WHITESPACE.test(character)) return Kind.Space;
  return Kind.Other;
}

function characterAt(text: string, index: number): string {
  return String.fromCodePoint(text.codePointAt(index) as number);
}

/**
 * GPT-2 style pre-tokenization, equivalent to the regular expression
 * /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu
 * but implemented as a single linear scan so that long whitespace runs cannot cause backtracking.
 */
export function pretokenize(text: string): string[] {
  const chunks: string[] = [];
  const length = text.length;
  let start = 0;
  while (start < length) {
    const first = characterAt(text, start);
    if (first === "'") {
      const two = text.slice(start + 1, start + 3);
      if (two === "ll" || two === "ve" || two === "re") {
        chunks.push(text.slice(start, start + 3));
        start += 3;
        continue;
      }
      const one = text[start + 1];
      if (one === "s" || one === "d" || one === "m" || one === "t") {
        chunks.push(text.slice(start, start + 2));
        start += 2;
        continue;
      }
    }
    let body = start;
    if (
      first === " " &&
      start + 1 < length &&
      kindOf(characterAt(text, start + 1)) !== Kind.Space
    ) {
      body = start + 1;
    }
    const bodyCharacter = characterAt(text, body);
    const kind = kindOf(bodyCharacter);
    if (kind !== Kind.Space) {
      let end = body + bodyCharacter.length;
      while (end < length) {
        const next = characterAt(text, end);
        if (kindOf(next) !== kind) break;
        end += next.length;
      }
      chunks.push(text.slice(start, end));
      start = end;
      continue;
    }
    let end = start;
    while (end < length && kindOf(characterAt(text, end)) === Kind.Space) {
      end += characterAt(text, end).length;
    }
    if (end < length && end - start > 1) {
      // Leave the final whitespace character to attach to the following word, as GPT-2 does.
      const last = text.codePointAt(end - 1) as number;
      end -= last >= 0xdc00 && last <= 0xdfff ? 2 : 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function pairKey(left: number, right: number): number {
  return left * 1_000_003 + right;
}

/**
 * Learns up to `mergeCount` merges from `corpus`. Ties are broken by the smallest (left, right) pair
 * so that training is fully deterministic. Training stops early when no pair occurs at least twice.
 */
export function trainBpe(corpus: string, mergeCount: number): Merge[] {
  const chunkCounts = new Map<string, number>();
  for (const chunk of pretokenize(corpus)) {
    chunkCounts.set(chunk, (chunkCounts.get(chunk) ?? 0) + 1);
  }
  const words: { symbols: number[]; count: number }[] = [];
  for (const [chunk, count] of chunkCounts) {
    words.push({ symbols: Array.from(encoder.encode(chunk)), count });
  }

  const merges: Merge[] = [];
  for (let step = 0; step < mergeCount; step++) {
    const pairCounts = new Map<number, { left: number; right: number; count: number }>();
    for (const word of words) {
      for (let i = 0; i + 1 < word.symbols.length; i++) {
        const left = word.symbols[i] as number;
        const right = word.symbols[i + 1] as number;
        const key = pairKey(left, right);
        const entry = pairCounts.get(key);
        if (entry) {
          entry.count += word.count;
        } else {
          pairCounts.set(key, { left, right, count: word.count });
        }
      }
    }
    let best: { left: number; right: number; count: number } | undefined;
    for (const entry of pairCounts.values()) {
      if (
        best === undefined ||
        entry.count > best.count ||
        (entry.count === best.count &&
          (entry.left < best.left || (entry.left === best.left && entry.right < best.right)))
      ) {
        best = entry;
      }
    }
    if (best === undefined || best.count < 2) {
      break;
    }
    const newId = 256 + merges.length;
    merges.push([best.left, best.right]);
    for (const word of words) {
      word.symbols = applyMerge(word.symbols, best.left, best.right, newId);
    }
  }
  return merges;
}

function applyMerge(symbols: number[], left: number, right: number, newId: number): number[] {
  const output: number[] = [];
  let i = 0;
  while (i < symbols.length) {
    if (i + 1 < symbols.length && symbols[i] === left && symbols[i + 1] === right) {
      output.push(newId);
      i += 2;
    } else {
      output.push(symbols[i] as number);
      i += 1;
    }
  }
  return output;
}

export class BpeTokenizer {
  private readonly ranks = new Map<number, number>();
  private readonly tokenBytes: Uint8Array[] = [];
  private readonly cache = new Map<string, number[]>();
  private static readonly CACHE_LIMIT = 10_000;

  constructor(private readonly merges: readonly Merge[]) {
    for (let byte = 0; byte < 256; byte++) {
      this.tokenBytes.push(Uint8Array.of(byte));
    }
    merges.forEach(([left, right], index) => {
      const leftBytes = this.tokenBytes[left];
      const rightBytes = this.tokenBytes[right];
      if (leftBytes === undefined || rightBytes === undefined) {
        throw new Error(`merge ${index} references an unknown token id`);
      }
      const combined = new Uint8Array(leftBytes.length + rightBytes.length);
      combined.set(leftBytes, 0);
      combined.set(rightBytes, leftBytes.length);
      this.tokenBytes.push(combined);
      this.ranks.set(pairKey(left, right), index);
    });
  }

  get vocabularySize(): number {
    return 256 + this.merges.length;
  }

  encode(text: string): number[] {
    const ids: number[] = [];
    for (const chunk of pretokenize(text)) {
      for (const id of this.encodeChunk(chunk)) {
        ids.push(id);
      }
    }
    return ids;
  }

  decode(ids: readonly number[]): string {
    return decoder.decode(this.decodeBytes(ids));
  }

  decodeBytes(ids: readonly number[]): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (const id of ids) {
      const bytes = this.tokenBytes[id];
      if (bytes === undefined) {
        throw new RangeError(`unknown token id ${id}`);
      }
      parts.push(bytes);
      total += bytes.length;
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  /** Returns the decoded text of a single token (lossy for tokens that split a UTF-8 character). */
  tokenText(id: number): string {
    return this.decode([id]);
  }

  private encodeChunk(chunk: string): number[] {
    const cached = this.cache.get(chunk);
    if (cached !== undefined) {
      return cached;
    }
    let symbols = Array.from(encoder.encode(chunk));
    while (symbols.length > 1) {
      let bestRank = Number.POSITIVE_INFINITY;
      let bestIndex = -1;
      for (let i = 0; i + 1 < symbols.length; i++) {
        const rank = this.ranks.get(pairKey(symbols[i] as number, symbols[i + 1] as number));
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          bestIndex = i;
        }
      }
      if (bestIndex < 0) {
        break;
      }
      const merge = this.merges[bestRank] as Merge;
      symbols = applyMerge(symbols, merge[0], merge[1], 256 + bestRank);
    }
    if (this.cache.size >= BpeTokenizer.CACHE_LIMIT) {
      this.cache.clear();
    }
    this.cache.set(chunk, symbols);
    return symbols;
  }
}

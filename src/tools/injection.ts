/**
 * Rule-based prompt-injection, obfuscation, secret, and personal information (PII) detection.
 * Rules are transparent regular expressions with fixed weights. This is a screening heuristic: it
 * catches common phrasings and leaked identifiers, and it can be evaded by paraphrase.
 */

export type Category = "injection" | "exfiltration" | "obfuscation" | "pii" | "secret";

export const ALL_CATEGORIES: readonly Category[] = [
  "injection",
  "exfiltration",
  "obfuscation",
  "pii",
  "secret",
];

export interface Rule {
  id: string;
  category: Category;
  weight: number;
  description: string;
  pattern: RegExp;
  /** Optional extra check on the matched text (for example the Luhn checksum). */
  accept?: (match: string) => boolean;
  /** Replacement label used when redacting. */
  label?: string;
}

export interface Finding {
  ruleId: string;
  category: Category;
  weight: number;
  description: string;
  /** Start offset in UTF-16 code units (JavaScript string index), inclusive. */
  start: number;
  /** End offset in UTF-16 code units, exclusive. */
  end: number;
  excerpt: string;
}

export interface ScanResult {
  riskScore: number;
  riskLevel: "none" | "low" | "medium" | "high";
  categoryScores: Record<Category, number>;
  findingCount: number;
  findings: Finding[];
  redactedText?: string;
  notes: string[];
}

export function luhnValid(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export const RULES: readonly Rule[] = [
  {
    id: "ignore-instructions",
    category: "injection",
    weight: 0.8,
    description: "Asks the model to ignore or override earlier instructions",
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass|skip)\s+(?:(?:all|any|every|the|your|my|of|these|those)\s+)*(?:previous|prior|above|earlier|preceding|initial|original|system|developer)?\s*(?:instructions?|prompts?|rules|directions|guidelines|directives)\b/gi,
  },
  {
    id: "reveal-system-prompt",
    category: "injection",
    weight: 0.7,
    description: "Asks the model to reveal its system prompt or hidden instructions",
    pattern:
      /\b(?:reveal|show|print|repeat|output|display|leak|dump|tell\s+me)\s+(?:me\s+)?(?:your|the)\s+(?:entire\s+|full\s+|original\s+)?(?:system\s+prompt|system\s+message|hidden\s+(?:prompt|instructions)|initial\s+(?:prompt|instructions)|instructions\s+above)\b/gi,
  },
  {
    id: "role-override",
    category: "injection",
    weight: 0.6,
    description: "Attempts to reassign the model's role or persona",
    pattern:
      /\byou\s+are\s+(?:now|no\s+longer)\b|\bfrom\s+now\s+on,?\s+you\s+(?:are|will|must)\b|\b(?:act|behave|respond)\s+as\s+(?:an?\s+)?(?:unrestricted|unfiltered|uncensored|jailbroken)\b|\bpretend\s+(?:that\s+)?you\s+(?:are|have)\s+no\s+(?:rules|restrictions|guidelines)\b/gi,
  },
  {
    id: "jailbreak-keyword",
    category: "injection",
    weight: 0.6,
    description: "Known jailbreak vocabulary (DAN, developer mode, jailbreak)",
    pattern: /\bDAN\b|\bdo\s+anything\s+now\b|\bdeveloper\s+mode\b|\bjailbr(?:eak|oken)\b/gi,
  },
  {
    id: "chat-template-token",
    category: "injection",
    weight: 0.7,
    description: "Chat template control tokens that can fake a conversation turn",
    pattern:
      /<\|(?:im_start|im_end|system|user|assistant|endoftext|eot_id|start_header_id|end_header_id)\|>|\[\/?INST\]|<<\/?SYS>>/g,
  },
  {
    id: "fake-role-header",
    category: "injection",
    weight: 0.4,
    description: "A line that impersonates a system or assistant message header",
    pattern:
      /^[ \t]*(?:#{1,6}[ \t]*)?(?:system|assistant|developer)[ \t]*(?:message|prompt)?[ \t]*:/gim,
  },
  {
    id: "new-instructions",
    category: "injection",
    weight: 0.5,
    description: "Introduces replacement instructions",
    pattern: /\b(?:new|updated|real|actual|revised)\s+(?:system\s+)?instructions?\s*:/gi,
  },
  {
    id: "markdown-image-exfiltration",
    category: "exfiltration",
    weight: 0.6,
    description: "Markdown image with a query string, a common data exfiltration channel",
    pattern: /!\[[^\]]*\]\(\s*https?:\/\/[^)\s]*\?[^)\s]*\)/gi,
  },
  {
    id: "send-data-elsewhere",
    category: "exfiltration",
    weight: 0.6,
    description: "Asks the model to send conversation data or secrets to a destination",
    pattern:
      /\b(?:send|post|upload|forward|email|transmit)\s+(?:all\s+|the\s+|this\s+|your\s+)?(?:conversation|chat\s+history|messages|user\s+data|data|credentials|secrets|api\s+keys?|passwords?|tokens?)\s+to\b/gi,
  },
  {
    id: "invisible-characters",
    category: "obfuscation",
    weight: 0.3,
    description: "Zero-width or bidirectional control characters that hide text",
    pattern: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]+/g,
  },
  {
    id: "unicode-tag-characters",
    category: "obfuscation",
    weight: 0.8,
    description: "Unicode tag characters (U+E0000 block) that can smuggle invisible ASCII text",
    pattern: /[\u{E0000}-\u{E007F}]+/gu,
  },
  {
    id: "long-base64",
    category: "obfuscation",
    weight: 0.3,
    description: "Long base64-like blob that may hide an encoded payload",
    pattern: /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{80,}={0,2}/g,
  },
  {
    id: "private-key",
    category: "secret",
    weight: 0.9,
    description: "PEM private key header",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
    label: "[PRIVATE_KEY]",
  },
  {
    id: "aws-access-key",
    category: "secret",
    weight: 0.7,
    description: "AWS access key identifier",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    label: "[AWS_KEY]",
  },
  {
    id: "github-token",
    category: "secret",
    weight: 0.7,
    description: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
    label: "[GITHUB_TOKEN]",
  },
  {
    id: "api-key",
    category: "secret",
    weight: 0.7,
    description: "API key with an sk- prefix (OpenAI and Anthropic style)",
    pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
    label: "[API_KEY]",
  },
  {
    id: "us-social-security-number",
    category: "pii",
    weight: 0.6,
    description: "United States Social Security number",
    pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    label: "[SSN]",
  },
  {
    id: "credit-card",
    category: "pii",
    weight: 0.6,
    description: "Payment card number (passes the Luhn checksum)",
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    accept: luhnValid,
    label: "[CARD]",
  },
  {
    id: "email-address",
    category: "pii",
    weight: 0.3,
    description: "Email address",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    label: "[EMAIL]",
  },
  {
    id: "phone-number",
    category: "pii",
    weight: 0.3,
    description: "Phone number (North American or E.164 international format)",
    pattern:
      /(?<![\w+])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b|(?<![\w+])\+[1-9]\d{7,14}\b/g,
    label: "[PHONE]",
  },
  {
    id: "ipv4-address",
    category: "pii",
    weight: 0.1,
    description: "IPv4 address",
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    label: "[IP_ADDRESS]",
  },
];

export interface ScanOptions {
  text: string;
  categories?: Category[] | undefined;
  redact?: boolean | undefined;
  maxFindings?: number | undefined;
}

function excerpt(
  text: string,
  finding: { start: number; end: number },
  category: Category,
): string {
  const raw = text.slice(finding.start, finding.end);
  if (category === "secret") {
    return raw.length <= 8 ? "****" : `${raw.slice(0, 4)}****${raw.slice(-2)}`;
  }
  if (category === "obfuscation" && !/[A-Za-z0-9]/.test(raw)) {
    return Array.from(raw)
      .map(
        (character) =>
          `U+${(character.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`,
      )
      .slice(0, 8)
      .join(" ");
  }
  return raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
}

const SPAN_EXCLUSIVE: ReadonlySet<Category> = new Set(["pii", "secret"]);

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function scanText(options: ScanOptions): ScanResult {
  const { text } = options;
  const enabled = new Set(options.categories ?? ALL_CATEGORIES);
  const maxFindings = options.maxFindings ?? 200;
  const candidates: (Finding & { label?: string })[] = [];
  for (const rule of RULES) {
    if (!enabled.has(rule.category)) continue;
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.accept && !rule.accept(match[0])) continue;
      const start = match.index;
      const end = start + match[0].length;
      const finding: Finding & { label?: string } = {
        ruleId: rule.id,
        category: rule.category,
        weight: rule.weight,
        description: rule.description,
        start,
        end,
        excerpt: excerpt(text, { start, end }, rule.category),
      };
      if (rule.label !== undefined) finding.label = rule.label;
      candidates.push(finding);
    }
  }

  // Identifier rules can overlap (a card number also looks like a phone number); keep the stronger.
  candidates.sort((x, y) => y.weight - x.weight || x.start - y.start);
  const accepted: typeof candidates = [];
  for (const candidate of candidates) {
    if (
      SPAN_EXCLUSIVE.has(candidate.category) &&
      accepted.some((other) => SPAN_EXCLUSIVE.has(other.category) && overlaps(candidate, other))
    ) {
      continue;
    }
    accepted.push(candidate);
  }
  accepted.sort((x, y) => x.start - y.start || y.weight - x.weight);

  const ruleWeights = new Map<string, { category: Category; weight: number }>();
  for (const finding of accepted) {
    ruleWeights.set(finding.ruleId, { category: finding.category, weight: finding.weight });
  }
  const categoryScores = Object.fromEntries(
    ALL_CATEGORIES.map((category) => [category, 0]),
  ) as Record<Category, number>;
  let survival = 1;
  const categorySurvival = new Map<Category, number>();
  for (const { category, weight } of ruleWeights.values()) {
    survival *= 1 - weight;
    categorySurvival.set(category, (categorySurvival.get(category) ?? 1) * (1 - weight));
  }
  for (const [category, value] of categorySurvival) {
    categoryScores[category] = Math.round((1 - value) * 1000) / 1000;
  }
  const riskScore = Math.round((1 - survival) * 1000) / 1000;
  const riskLevel =
    riskScore >= 0.7 ? "high" : riskScore >= 0.4 ? "medium" : riskScore > 0 ? "low" : "none";

  const result: ScanResult = {
    riskScore,
    riskLevel,
    categoryScores,
    findingCount: accepted.length,
    findings: accepted.slice(0, maxFindings).map(({ label: _label, ...finding }) => finding),
    notes: [
      "riskScore = 1 - product(1 - weight) over distinct matched rules; each rule counts once.",
      "Offsets are UTF-16 code unit indices (JavaScript string indices), end exclusive.",
      "Rule-based screening: paraphrased or encoded attacks can evade it; pair it with model-side defenses.",
    ],
  };

  if (options.redact ?? false) {
    let redacted = "";
    let cursor = 0;
    const spans = accepted
      .filter((finding) => finding.label !== undefined)
      .sort((x, y) => x.start - y.start);
    for (const span of spans) {
      if (span.start < cursor) continue;
      redacted += text.slice(cursor, span.start) + (span.label as string);
      cursor = span.end;
    }
    result.redactedText = redacted + text.slice(cursor);
  }
  return result;
}

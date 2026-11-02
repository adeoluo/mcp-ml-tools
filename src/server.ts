import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { Config } from "./config.js";
import { publicConfig } from "./config.js";
import { loadDocumentsFromDirectory } from "./documents.js";
import { ToolInputError } from "./errors.js";
import { Metrics } from "./metrics.js";
import { PRICE_TABLE_AS_OF } from "./prices.js";
import { Bm25Index, type Document } from "./tools/bm25.js";
import { ALL_CATEGORIES, scanText } from "./tools/injection.js";
import { validateJson } from "./tools/json-schema.js";
import { evalCompare } from "./tools/statistics.js";
import { tokenize } from "./tools/tokenize.js";
import { NAME, VERSION } from "./version.js";
import { TOOL_DOCUMENTATION } from "./documentation.js";

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

const MAX_TEXT = 2_000_000;

export interface ServerDependencies {
  config: Config;
  metrics?: Metrics;
}

/** Wraps a tool handler: structured output, timing, and input errors reported as tool errors. */
async function run(
  metrics: Metrics,
  tool: string,
  handler: () => Promise<object> | object,
): Promise<CallToolResult> {
  const started = performance.now();
  try {
    const result = await handler();
    metrics.record(tool, (performance.now() - started) / 1000, false);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (error) {
    metrics.record(tool, (performance.now() - started) / 1000, true);
    const message =
      error instanceof ToolInputError
        ? error.message
        : `internal error: ${error instanceof Error ? error.message : String(error)}`;
    if (!(error instanceof ToolInputError)) {
      console.error(`[${NAME}] ${tool} failed:`, error);
    }
    return { isError: true, content: [{ type: "text", text: `${tool}: ${message}` }] };
  }
}

export function createServer({ config, metrics = new Metrics() }: ServerDependencies): McpServer {
  const server = new McpServer(
    { name: NAME, version: VERSION },
    {
      instructions:
        "Machine learning engineering tools: token counting and cost estimates, BM25 search, " +
        "paired significance testing for evaluation scores, JSON Schema validation, and " +
        "prompt-injection and PII scanning. All tools are deterministic and read-only.",
    },
  );

  server.registerTool(
    "tokenize",
    {
      title: "Count tokens and estimate cost",
      description:
        "Tokenizes text with the bundled byte-level BPE (exact counts and token ids for that " +
        "vocabulary), and estimates token counts and United States dollar cost for common model " +
        "families from the configured price table. Per-model counts are character-based " +
        "approximations, not the providers' tokenizers.",
      inputSchema: {
        text: z.string().max(MAX_TEXT).describe("Text to tokenize"),
        models: z
          .array(z.string())
          .optional()
          .describe("Model names from the price table to estimate (default: all)"),
        expectedOutputTokens: z
          .number()
          .int()
          .nonnegative()
          .max(10_000_000)
          .optional()
          .describe("Expected completion length in tokens, used for output cost (default 0)"),
        includeTokenIds: z
          .boolean()
          .optional()
          .describe("Return token ids and strings (default true)"),
        maxTokenIds: z
          .number()
          .int()
          .positive()
          .max(100_000)
          .optional()
          .describe("Maximum number of token ids to return (default 2000)"),
      },
      outputSchema: {
        characters: z.number(),
        bytes: z.number(),
        builtInBpe: z.looseObject({ tokenCount: z.number(), vocabularySize: z.number() }),
        estimates: z.array(
          z.looseObject({
            model: z.string(),
            approximateInputTokens: z.number(),
            totalCostUsd: z.number(),
          }),
        ),
        notes: z.array(z.string()),
      },
      annotations: READ_ONLY,
    },
    (args) => run(metrics, "tokenize", () => tokenize(args, config.prices)),
  );

  server.registerTool(
    "bm25_search",
    {
      title: "BM25 search",
      description:
        "Builds an Okapi BM25 index over documents passed inline and/or loaded from a directory " +
        "inside the configured documentRoot, then returns the top-k documents with scores, " +
        "matched terms, and snippets. Disk access is disabled unless documentRoot is configured.",
      inputSchema: {
        query: z.string().min(1).max(10_000).describe("Search query"),
        documents: z
          .array(z.object({ id: z.string().min(1), text: z.string().max(MAX_TEXT) }))
          .max(50_000)
          .optional()
          .describe("Inline documents to index"),
        directory: z
          .string()
          .optional()
          .describe("Directory relative to documentRoot to load .txt/.md files from"),
        topK: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Results to return (default 5)"),
        k1: z
          .number()
          .min(0)
          .max(10)
          .optional()
          .describe("Term frequency saturation (default 1.2)"),
        b: z.number().min(0).max(1).optional().describe("Length normalization (default 0.75)"),
      },
      outputSchema: {
        query: z.string(),
        documentCount: z.number(),
        vocabularySize: z.number(),
        hits: z.array(
          z.object({
            rank: z.number(),
            id: z.string(),
            score: z.number(),
            matchedTerms: z.array(z.string()),
            snippet: z.string(),
          }),
        ),
        skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      run(metrics, "bm25_search", async () => {
        const documents: Document[] = [...(args.documents ?? [])];
        let skipped: { path: string; reason: string }[] = [];
        if (args.directory !== undefined) {
          const loaded = await loadDocumentsFromDirectory(config.documentRoot, args.directory, {
            extensions: config.documentExtensions,
            maxFiles: config.maxFiles,
            maxFileBytes: config.maxFileBytes,
          });
          documents.push(...loaded.documents);
          skipped = loaded.skipped;
        }
        if (documents.length === 0) {
          throw new ToolInputError(
            "no documents: pass documents and/or a directory with text files",
          );
        }
        const index = new Bm25Index(documents, { k1: args.k1 ?? 1.2, b: args.b ?? 0.75 });
        return {
          query: args.query,
          documentCount: index.size,
          vocabularySize: index.vocabularySize,
          hits: index.search(args.query, args.topK ?? 5),
          skipped,
        };
      }),
  );

  server.registerTool(
    "eval_compare",
    {
      title: "Compare two models' per-example scores",
      description:
        "Paired comparison of model A and model B on the same examples: mean difference " +
        "(B minus A), seeded paired bootstrap confidence interval and two-sided p-value, win/tie " +
        "counts, and McNemar's test (exact and chi-square) when every score is 0 or 1.",
      inputSchema: {
        scoresA: z
          .array(z.number())
          .min(2)
          .max(1_000_000)
          .describe("Per-example scores for model A"),
        scoresB: z
          .array(z.number())
          .min(2)
          .max(1_000_000)
          .describe("Per-example scores for model B, same order"),
        bootstrapSamples: z
          .number()
          .int()
          .min(100)
          .max(100_000)
          .optional()
          .describe("Bootstrap resamples (default 10000)"),
        confidenceLevel: z
          .number()
          .gt(0)
          .lt(1)
          .optional()
          .describe("Confidence level (default 0.95)"),
        seed: z.number().int().nonnegative().optional().describe("Random seed (default 0)"),
      },
      outputSchema: {
        n: z.number(),
        meanA: z.number(),
        meanB: z.number(),
        meanDifference: z.number(),
        standardError: z.number(),
        bootstrap: z.looseObject({
          confidenceInterval: z.tuple([z.number(), z.number()]),
          pValue: z.number(),
        }),
        winsA: z.number(),
        winsB: z.number(),
        ties: z.number(),
        mcnemar: z.looseObject({ recommendedPValue: z.number() }).nullable(),
        interpretation: z.string(),
      },
      annotations: READ_ONLY,
    },
    (args) => run(metrics, "eval_compare", () => evalCompare(args)),
  );

  server.registerTool(
    "json_schema_validate",
    {
      title: "Validate JSON against a JSON Schema",
      description:
        "Validates a JSON document (or raw model output text, optionally wrapped in a Markdown " +
        "code fence) against a JSON Schema using Ajv with formats. Returns every error with a " +
        "JSON Pointer and JSONPath to the offending value, or the line and column of a parse error. " +
        "Supports draft-07, 2019-09, and 2020-12 (detected from $schema).",
      inputSchema: {
        schema: z
          .union([z.record(z.string(), z.unknown()), z.boolean()])
          .describe("The JSON Schema"),
        document: z.unknown().optional().describe("Parsed JSON value to validate"),
        documentText: z
          .string()
          .max(MAX_TEXT)
          .optional()
          .describe("Raw JSON text to parse then validate (for example an LLM response)"),
        draft: z
          .enum(["draft-07", "2019-09", "2020-12"])
          .optional()
          .describe("Override draft detection"),
        stripCodeFences: z
          .boolean()
          .optional()
          .describe("Strip a surrounding ``` fence (default true)"),
        maxErrors: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Maximum errors (default 50)"),
      },
      outputSchema: {
        valid: z.boolean(),
        draft: z.string(),
        errorCount: z.number(),
        errors: z.array(
          z.object({
            path: z.string(),
            jsonPath: z.string(),
            keyword: z.string(),
            message: z.string(),
            schemaPath: z.string(),
            params: z.record(z.string(), z.unknown()),
          }),
        ),
        parseError: z
          .object({
            message: z.string(),
            line: z.number(),
            column: z.number(),
            position: z.number(),
          })
          .optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => run(metrics, "json_schema_validate", () => validateJson(args)),
  );

  server.registerTool(
    "prompt_injection_scan",
    {
      title: "Scan text for prompt injection and PII",
      description:
        "Rule-based scan of untrusted text (retrieved documents, tool output, user input) for " +
        "prompt-injection phrasing, exfiltration patterns, hidden characters, secrets, and " +
        "personal information. Returns findings with character spans, a 0 to 1 risk score, and " +
        "optionally a redacted copy of the text.",
      inputSchema: {
        text: z.string().max(MAX_TEXT).describe("Text to scan"),
        categories: z
          .array(z.enum(ALL_CATEGORIES as unknown as [string, ...string[]]))
          .optional()
          .describe("Categories to check (default: all)"),
        redact: z
          .boolean()
          .optional()
          .describe("Return redactedText with PII and secrets replaced"),
        maxFindings: z
          .number()
          .int()
          .positive()
          .max(10_000)
          .optional()
          .describe("Maximum findings (default 200)"),
      },
      outputSchema: {
        riskScore: z.number(),
        riskLevel: z.enum(["none", "low", "medium", "high"]),
        categoryScores: z.record(z.string(), z.number()),
        findingCount: z.number(),
        findings: z.array(
          z.object({
            ruleId: z.string(),
            category: z.string(),
            weight: z.number(),
            description: z.string(),
            start: z.number(),
            end: z.number(),
            excerpt: z.string(),
          }),
        ),
        redactedText: z.string().optional(),
        notes: z.array(z.string()),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      run(metrics, "prompt_injection_scan", () =>
        scanText({
          ...args,
          categories: args.categories as (typeof ALL_CATEGORIES)[number][] | undefined,
        }),
      ),
  );

  server.registerResource(
    "prices",
    "mltools://prices",
    {
      title: "Model price table",
      description:
        "Price table used by the tokenize tool (United States dollars per million tokens)",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              asOf: PRICE_TABLE_AS_OF,
              currency: "USD",
              unit: "per 1,000,000 tokens",
              note: "Illustrative defaults merged with any configured overrides; verify against provider pricing pages.",
              models: config.prices,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "tool-documentation",
    "mltools://docs/tools",
    {
      title: "Tool documentation",
      description: "Usage notes, parameters, and examples for every tool",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: TOOL_DOCUMENTATION }],
    }),
  );

  server.registerResource(
    "configuration",
    "mltools://config",
    {
      title: "Effective configuration",
      description:
        "The active configuration (filesystem allowlist, limits, price models); secrets omitted",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(publicConfig(config), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "metrics",
    "mltools://metrics",
    {
      title: "Tool call metrics",
      description: "Per-tool call counts, error counts, and total latency for this server process",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(metrics.snapshot(), null, 2),
        },
      ],
    }),
  );

  return server;
}

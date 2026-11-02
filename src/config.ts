import { readFileSync } from "node:fs";
import path from "node:path";
import * as z from "zod";
import { DEFAULT_PRICES, type ModelPrice } from "./prices.js";

export const modelPriceSchema = z.object({
  model: z.string().min(1),
  provider: z.string().min(1),
  inputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
  charactersPerToken: z.number().positive(),
  tokenizerNote: z.string().default("approximated from character count"),
});

export const fileConfigSchema = z
  .object({
    documentRoot: z.string().min(1).nullable().optional(),
    documentExtensions: z
      .array(z.string().regex(/^\.[\w.-]+$/))
      .min(1)
      .optional(),
    maxFiles: z.number().int().positive().max(100_000).optional(),
    maxFileBytes: z.number().int().positive().max(100_000_000).optional(),
    prices: z.array(modelPriceSchema).optional(),
    http: z
      .object({
        host: z.string().min(1).optional(),
        port: z.number().int().min(0).max(65_535).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface Config {
  /** Absolute path of the only directory tree the server may read, or null (no disk access). */
  documentRoot: string | null;
  documentExtensions: string[];
  maxFiles: number;
  maxFileBytes: number;
  prices: ModelPrice[];
  http: { host: string; port: number; token: string | null };
  /** Where the configuration file came from, if any (for the mltools://config resource). */
  source: string | null;
}

export const DEFAULT_CONFIG: Config = {
  documentRoot: null,
  documentExtensions: [".txt", ".md", ".markdown", ".rst", ".text"],
  maxFiles: 1000,
  maxFileBytes: 1_000_000,
  prices: [...DEFAULT_PRICES],
  http: { host: "127.0.0.1", port: 3333, token: null },
  source: null,
};

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** Merges price entries by model name: configured entries replace or extend the defaults. */
export function mergePrices(
  base: readonly ModelPrice[],
  overrides: readonly ModelPrice[],
): ModelPrice[] {
  const merged = new Map(base.map((price) => [price.model, price]));
  for (const price of overrides) merged.set(price.model, price);
  return [...merged.values()];
}

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ConfigError(`${name} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

export interface LoadConfigOptions {
  configPath?: string | undefined;
  documentRoot?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/** Precedence (lowest to highest): defaults, configuration file, environment variables, flags. */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const config: Config = structuredClone(DEFAULT_CONFIG);

  const configPath = options.configPath ?? env.MCP_ML_TOOLS_CONFIG;
  if (configPath !== undefined && configPath !== "") {
    const absolute = path.resolve(cwd, configPath);
    let raw: string;
    try {
      raw = readFileSync(absolute, "utf8");
    } catch {
      throw new ConfigError(`cannot read configuration file: ${absolute}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new ConfigError(`configuration file is not valid JSON: ${(error as Error).message}`);
    }
    const parsed = fileConfigSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new ConfigError(`invalid configuration file ${absolute}: ${issues}`);
    }
    const file = parsed.data;
    const directory = path.dirname(absolute);
    if (file.documentRoot !== undefined) {
      config.documentRoot =
        file.documentRoot === null ? null : path.resolve(directory, file.documentRoot);
    }
    if (file.documentExtensions) config.documentExtensions = file.documentExtensions;
    if (file.maxFiles !== undefined) config.maxFiles = file.maxFiles;
    if (file.maxFileBytes !== undefined) config.maxFileBytes = file.maxFileBytes;
    if (file.prices) config.prices = mergePrices(config.prices, file.prices);
    if (file.http?.host !== undefined) config.http.host = file.http.host;
    if (file.http?.port !== undefined) config.http.port = file.http.port;
    config.source = absolute;
  }

  if (env.MCP_ML_TOOLS_DOCUMENT_ROOT) {
    config.documentRoot = path.resolve(cwd, env.MCP_ML_TOOLS_DOCUMENT_ROOT);
  }
  if (env.MCP_ML_TOOLS_MAX_FILES) {
    config.maxFiles = positiveInteger("MCP_ML_TOOLS_MAX_FILES", env.MCP_ML_TOOLS_MAX_FILES);
  }
  if (env.MCP_ML_TOOLS_MAX_FILE_BYTES) {
    config.maxFileBytes = positiveInteger(
      "MCP_ML_TOOLS_MAX_FILE_BYTES",
      env.MCP_ML_TOOLS_MAX_FILE_BYTES,
    );
  }
  if (env.MCP_ML_TOOLS_HTTP_HOST) config.http.host = env.MCP_ML_TOOLS_HTTP_HOST;
  if (env.MCP_ML_TOOLS_HTTP_PORT) {
    config.http.port = positiveInteger("MCP_ML_TOOLS_HTTP_PORT", env.MCP_ML_TOOLS_HTTP_PORT);
  }
  if (env.MCP_ML_TOOLS_HTTP_TOKEN) config.http.token = env.MCP_ML_TOOLS_HTTP_TOKEN;

  if (options.documentRoot !== undefined)
    config.documentRoot = path.resolve(cwd, options.documentRoot);
  if (options.host !== undefined) config.http.host = options.host;
  if (options.port !== undefined) config.http.port = options.port;
  return config;
}

/** The configuration with secrets removed, safe to expose as a resource. */
export function publicConfig(config: Config): Record<string, unknown> {
  return {
    documentRoot: config.documentRoot,
    filesystemAccess: config.documentRoot === null ? "disabled" : "allowlisted root only",
    documentExtensions: config.documentExtensions,
    maxFiles: config.maxFiles,
    maxFileBytes: config.maxFileBytes,
    priceModels: config.prices.map((price) => price.model),
    http: {
      host: config.http.host,
      port: config.http.port,
      tokenRequired: config.http.token !== null,
    },
    source: config.source,
  };
}

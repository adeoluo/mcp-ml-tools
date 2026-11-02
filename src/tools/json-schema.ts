import { Ajv, type ErrorObject, type Options } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { ToolInputError } from "../errors.js";

type FormatsPlugin = (ajv: Ajv) => Ajv;
// ajv-formats is CommonJS; depending on the loader the plugin is the module itself or its default.
const addFormats = ((addFormatsImport as unknown as { default?: FormatsPlugin }).default ??
  addFormatsImport) as unknown as FormatsPlugin;

export type Draft = "draft-07" | "2019-09" | "2020-12";

export interface ValidateOptions {
  schema: unknown;
  document?: unknown;
  documentText?: string | undefined;
  draft?: Draft | undefined;
  stripCodeFences?: boolean | undefined;
  maxErrors?: number | undefined;
}

export interface ValidationError {
  /** JSON Pointer to the offending location in the document ("" is the root). */
  path: string;
  /** The same location as a JSONPath-style expression, for readability. */
  jsonPath: string;
  keyword: string;
  message: string;
  schemaPath: string;
  params: Record<string, unknown>;
}

export interface ValidateResult {
  valid: boolean;
  draft: Draft;
  errorCount: number;
  errors: ValidationError[];
  parseError?: { message: string; line: number; column: number; position: number };
}

function escapeSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function pointerToJsonPath(pointer: string): string {
  if (pointer === "") return "$";
  const segments = pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let result = "$";
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) result += `[${segment}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(segment)) result += `.${segment}`;
    else result += `[${JSON.stringify(segment)}]`;
  }
  return result;
}

function detectDraft(schema: unknown): Draft {
  if (typeof schema === "object" && schema !== null && "$schema" in schema) {
    const declared = String((schema as { $schema: unknown }).$schema);
    if (declared.includes("2020-12")) return "2020-12";
    if (declared.includes("2019-09")) return "2019-09";
  }
  return "draft-07";
}

function createValidator(draft: Draft): Ajv {
  const options: Options = { allErrors: true, strict: false, verbose: false };
  const ajv =
    draft === "2020-12"
      ? new Ajv2020(options)
      : draft === "2019-09"
        ? new Ajv2019(options)
        : new Ajv(options);
  addFormats(ajv as Ajv);
  return ajv as Ajv;
}

/** Returns the body of a text wrapped in a Markdown code fence, or null if it is not fenced. */
export function stripCodeFence(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```") || trimmed.length < 6) {
    return null;
  }
  const newline = trimmed.indexOf("\n");
  if (newline < 0) return null;
  const language = trimmed.slice(3, newline).trim();
  if (!/^[\w-]*$/.test(language)) return null;
  return trimmed.slice(newline + 1, trimmed.length - 3);
}

export function lineAndColumn(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, position);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1] as string).length + 1 };
}

function parseDocument(
  text: string,
  stripFences: boolean,
): { value?: unknown; error?: ValidateResult["parseError"] } {
  const fenced = stripFences ? stripCodeFence(text) : null;
  const body = fenced ?? text;
  try {
    return { value: JSON.parse(body) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /position (\d+)/.exec(message);
    const position = match ? Number(match[1]) : body.length;
    return { error: { message, position, ...lineAndColumn(body, position) } };
  }
}

function convertError(error: ErrorObject): ValidationError {
  let path = error.instancePath;
  const params = error.params as Record<string, unknown>;
  if (error.keyword === "required" && typeof params.missingProperty === "string") {
    path = `${path}/${escapeSegment(params.missingProperty)}`;
  } else if (
    error.keyword === "additionalProperties" &&
    typeof params.additionalProperty === "string"
  ) {
    path = `${path}/${escapeSegment(params.additionalProperty)}`;
  } else if (
    error.keyword === "unevaluatedProperties" &&
    typeof params.unevaluatedProperty === "string"
  ) {
    path = `${path}/${escapeSegment(params.unevaluatedProperty)}`;
  }
  return {
    path,
    jsonPath: pointerToJsonPath(path),
    keyword: error.keyword,
    message: error.message ?? "validation failed",
    schemaPath: error.schemaPath,
    params,
  };
}

export function validateJson(options: ValidateOptions): ValidateResult {
  const draft = options.draft ?? detectDraft(options.schema);
  const maxErrors = options.maxErrors ?? 50;
  if (typeof options.schema !== "object" && typeof options.schema !== "boolean") {
    throw new ToolInputError("schema must be a JSON object (or boolean schema)");
  }
  if (options.schema === null) {
    throw new ToolInputError("schema must not be null");
  }
  const hasDocument = options.document !== undefined;
  const hasText = options.documentText !== undefined;
  if (hasDocument === hasText) {
    throw new ToolInputError("provide exactly one of document or documentText");
  }

  let document: unknown = options.document;
  if (hasText) {
    const parsed = parseDocument(options.documentText as string, options.stripCodeFences ?? true);
    if (parsed.error) {
      return { valid: false, draft, errorCount: 0, errors: [], parseError: parsed.error };
    }
    document = parsed.value;
  }

  const ajv = createValidator(draft);
  let validate;
  try {
    validate = ajv.compile(options.schema as object);
  } catch (error) {
    throw new ToolInputError(
      `invalid schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const valid = validate(document);
  const errors = (validate.errors ?? []).map(convertError);
  return {
    valid,
    draft,
    errorCount: errors.length,
    errors: errors.slice(0, maxErrors),
  };
}

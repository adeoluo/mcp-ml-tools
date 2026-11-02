import { describe, expect, it } from "vitest";
import {
  lineAndColumn,
  pointerToJsonPath,
  stripCodeFence,
  validateJson,
} from "../src/tools/json-schema.js";

const personSchema = {
  type: "object",
  required: ["name", "age", "contacts"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    age: { type: "integer", minimum: 0 },
    email: { type: "string", format: "email" },
    contacts: {
      type: "array",
      items: {
        type: "object",
        required: ["kind"],
        properties: { kind: { enum: ["phone", "email"] }, "value/raw": { type: "string" } },
      },
    },
  },
};

describe("json_schema_validate", () => {
  it("accepts a valid document", () => {
    const result = validateJson({
      schema: personSchema,
      document: { name: "Ada", age: 36, email: "ada@example.com", contacts: [{ kind: "phone" }] },
    });
    expect(result).toEqual({ valid: true, draft: "draft-07", errorCount: 0, errors: [] });
  });

  it("reports every error with a precise path", () => {
    const result = validateJson({
      schema: personSchema,
      document: {
        age: -1.5,
        email: "not-an-email",
        contacts: [{ kind: "phone" }, { kind: "fax", "value/raw": 5 }],
        extra: true,
      },
    });
    expect(result.valid).toBe(false);
    const byPath = Object.fromEntries(
      result.errors.map((error) => [`${error.path} ${error.keyword}`, error]),
    );
    expect(Object.keys(byPath).sort()).toEqual(
      [
        "/name required",
        "/extra additionalProperties",
        "/age type",
        "/age minimum",
        "/email format",
        "/contacts/1/kind enum",
        "/contacts/1/value~1raw type",
      ].sort(),
    );
    expect(byPath["/contacts/1/kind enum"]?.jsonPath).toBe("$.contacts[1].kind");
    expect(byPath["/contacts/1/value~1raw type"]?.jsonPath).toBe('$.contacts[1]["value/raw"]');
    expect(byPath["/name required"]?.schemaPath).toBe("#/required");
    expect(result.errorCount).toBe(7);
  });

  it("limits the number of returned errors but reports the full count", () => {
    const result = validateJson({ schema: personSchema, document: {}, maxErrors: 1 });
    expect(result.errorCount).toBe(3);
    expect(result.errors).toHaveLength(1);
  });

  it("parses raw model output, stripping a Markdown code fence", () => {
    const documentText = '```json\n{"name": "Ada", "age": 36, "contacts": []}\n```';
    expect(validateJson({ schema: personSchema, documentText }).valid).toBe(true);
    expect(
      validateJson({ schema: personSchema, documentText, stripCodeFences: false }).parseError,
    ).toBeDefined();
  });

  it("strips Markdown code fences without backtracking", () => {
    expect(stripCodeFence('```json\n{"a": 1}\n```')).toBe('{"a": 1}\n');
    expect(stripCodeFence("  ```\n[1]```  ")).toBe("[1]");
    expect(stripCodeFence('{"a": 1}')).toBeNull();
    expect(stripCodeFence("```json```")).toBeNull();
    expect(stripCodeFence("```not a language\n1\n```")).toBeNull();
    const adversarial = `\`\`\`\n${"\n".repeat(100_000)}`;
    const started = performance.now();
    expect(stripCodeFence(adversarial)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("locates JSON parse errors by line and column", () => {
    const result = validateJson({
      schema: personSchema,
      documentText: '{\n  "name": "Ada",\n  "age": 36,,\n}',
    });
    expect(result.valid).toBe(false);
    expect(result.parseError?.line).toBe(3);
    expect(result.parseError?.column).toBe(13);
    expect(lineAndColumn("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
  });

  it("detects draft 2020-12 and 2019-09 from $schema", () => {
    const schema2020 = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number" }],
      items: false,
    };
    const result = validateJson({ schema: schema2020, document: ["a", 1, "extra"] });
    expect(result.draft).toBe("2020-12");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe("");
    const schema2019 = {
      $schema: "https://json-schema.org/draft/2019-09/schema",
      type: "object",
      properties: { a: { type: "number" } },
      unevaluatedProperties: false,
    };
    const unevaluated = validateJson({ schema: schema2019, document: { a: 1, b: 2 } });
    expect(unevaluated.draft).toBe("2019-09");
    expect(unevaluated.errors[0]?.path).toBe("/b");
  });

  it("honors an explicit draft and boolean schemas", () => {
    expect(validateJson({ schema: true, document: 1, draft: "2020-12" }).valid).toBe(true);
    expect(validateJson({ schema: false, document: 1 }).valid).toBe(false);
  });

  it("rejects invalid schemas and ambiguous input", () => {
    expect(() => validateJson({ schema: { type: "not-a-type" }, document: 1 })).toThrow(
      /invalid schema/,
    );
    expect(() => validateJson({ schema: {}, document: 1, documentText: "1" })).toThrow(
      /exactly one/,
    );
    expect(() => validateJson({ schema: {} })).toThrow(/exactly one/);
    expect(() => validateJson({ schema: null, document: 1 })).toThrow(/null/);
    expect(() => validateJson({ schema: "string", document: 1 })).toThrow(/JSON object/);
  });

  it("converts JSON Pointers to JSONPath", () => {
    expect(pointerToJsonPath("")).toBe("$");
    expect(pointerToJsonPath("/a/0/b c/~0x")).toBe('$.a[0]["b c"]["~x"]');
  });
});

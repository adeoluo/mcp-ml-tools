import { describe, expect, it } from "vitest";
import { Metrics } from "../src/metrics.js";
import { mulberry32 } from "../src/random.js";

describe("metrics", () => {
  it("counts calls, errors, and time per tool in Prometheus format", () => {
    const metrics = new Metrics();
    metrics.record("tokenize", 0.5, false);
    metrics.record("tokenize", 0.25, true);
    metrics.record("bm25_search", 0.1, false);
    const snapshot = metrics.snapshot();
    expect(Object.keys(snapshot.tools)).toEqual(["bm25_search", "tokenize"]);
    expect(snapshot.tools.tokenize).toEqual({ calls: 2, errors: 1, totalSeconds: 0.75 });
    const text = metrics.prometheus();
    expect(text).toContain('mcp_ml_tools_tool_calls_total{tool="tokenize"} 2');
    expect(text).toContain('mcp_ml_tools_tool_errors_total{tool="tokenize"} 1');
    expect(text).toContain('mcp_ml_tools_tool_seconds_total{tool="tokenize"} 0.750000');
    expect(text).toMatch(/mcp_ml_tools_uptime_seconds \d/);
  });
});

describe("mulberry32", () => {
  it("is deterministic and uniform on [0, 1)", () => {
    const first = mulberry32(1);
    const second = mulberry32(1);
    const values = Array.from({ length: 10_000 }, () => first());
    expect(values.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => second()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    const average = values.reduce((total, value) => total + value, 0) / values.length;
    expect(average).toBeGreaterThan(0.48);
    expect(average).toBeLessThan(0.52);
  });
});

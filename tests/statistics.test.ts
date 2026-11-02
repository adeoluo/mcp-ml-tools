import { describe, expect, it } from "vitest";
import { ToolInputError } from "../src/errors.js";
import { mulberry32 } from "../src/random.js";
import {
  binomialHalfCdf,
  chiSquareOneDegreeSurvival,
  erfc,
  evalCompare,
  mcnemar,
  mean,
  quantile,
} from "../src/tools/statistics.js";

/** Builds paired binary outcomes with the given contingency counts. */
function contingency(bothCorrect: number, onlyA: number, onlyB: number, bothWrong: number) {
  const a: number[] = [];
  const b: number[] = [];
  const push = (count: number, x: number, y: number) => {
    for (let i = 0; i < count; i++) {
      a.push(x);
      b.push(y);
    }
  };
  push(bothCorrect, 1, 1);
  push(onlyA, 1, 0);
  push(onlyB, 0, 1);
  push(bothWrong, 0, 0);
  return { a, b };
}

describe("special functions (reference values from Python's math module)", () => {
  it("erfc", () => {
    expect(erfc(0)).toBeCloseTo(1, 7);
    expect(erfc(1)).toBeCloseTo(0.15729920705028516, 7);
    expect(erfc(-0.5)).toBeCloseTo(1.5204998778130465, 7);
  });

  it("chi-square survival with one degree of freedom", () => {
    expect(chiSquareOneDegreeSurvival(3.841458820694124)).toBeCloseTo(0.05, 6);
    expect(chiSquareOneDegreeSurvival(0)).toBe(1);
  });

  it("the binomial distribution", () => {
    expect(binomialHalfCdf(2, 12)).toBeCloseTo(79 / 4096, 12);
    expect(binomialHalfCdf(15, 45) * 2).toBeCloseTo(0.035697803555194696, 12);
    expect(binomialHalfCdf(-1, 5)).toBe(0);
    expect(binomialHalfCdf(5, 5)).toBe(1);
  });

  it("quantile matches NumPy's default linear interpolation", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantile([10], 0.9)).toBe(10);
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(mean([])).toBe(0);
  });
});

describe("McNemar's test", () => {
  it("matches hand-computed values for 10 versus 2 discordant pairs", () => {
    const { a, b } = contingency(50, 10, 2, 8);
    const result = mcnemar(a, b);
    expect(result).toMatchObject({
      onlyACorrect: 10,
      onlyBCorrect: 2,
      bothCorrect: 50,
      bothIncorrect: 8,
    });
    expect(result.chiSquareStatistic).toBeCloseTo(49 / 12, 12);
    expect(result.chiSquarePValue).toBeCloseTo(0.04330814281079198, 6);
    expect(result.exactPValue).toBeCloseTo(158 / 4096, 12);
    expect(result.recommendedMethod).toBe("exact-binomial");
    expect(result.recommendedPValue).toBe(result.exactPValue);
  });

  it("uses the chi-square approximation for 25 or more discordant pairs", () => {
    const { a, b } = contingency(0, 15, 30, 0);
    const result = mcnemar(a, b);
    expect(result.chiSquareStatistic).toBeCloseTo(4.355555555555555, 12);
    expect(result.chiSquarePValue).toBeCloseTo(0.03688842570704985, 6);
    expect(result.exactPValue).toBeCloseTo(0.035697803555194696, 9);
    expect(result.recommendedMethod).toBe("chi-square-continuity-corrected");
  });

  it("returns p = 1 when the models never disagree", () => {
    const result = mcnemar([1, 0, 1], [1, 0, 1]);
    expect(result.exactPValue).toBe(1);
    expect(result.chiSquarePValue).toBe(1);
  });
});

describe("eval_compare", () => {
  it("reports zero difference and p = 1 for identical scores", () => {
    const scores = [0.1, 0.5, 0.9, 0.3];
    const result = evalCompare({ scoresA: scores, scoresB: scores, bootstrapSamples: 500 });
    expect(result.meanDifference).toBe(0);
    expect(result.bootstrap.confidenceInterval).toEqual([0, 0]);
    expect(result.bootstrap.pValue).toBe(1);
    expect(result.ties).toBe(4);
    expect(result.mcnemar).toBeNull();
    expect(result.interpretation).toMatch(/No reliable difference/);
  });

  it("gives a degenerate interval and the minimum p-value for a constant improvement", () => {
    const scoresA = [0.2, 0.4, 0.6, 0.8, 1.0];
    const scoresB = scoresA.map((value) => value + 1);
    const result = evalCompare({ scoresA, scoresB, bootstrapSamples: 999 });
    expect(result.meanDifference).toBeCloseTo(1, 12);
    expect(result.bootstrap.confidenceInterval[0]).toBeCloseTo(1, 12);
    expect(result.bootstrap.confidenceInterval[1]).toBeCloseTo(1, 12);
    expect(result.bootstrap.pValue).toBeCloseTo(1 / 1000, 12);
    expect(result.winsB).toBe(5);
    expect(result.standardError).toBeCloseTo(0, 12);
    expect(result.interpretation).toMatch(/Model B scores higher/);
  });

  it("agrees with the normal approximation on a large sample", () => {
    const random = mulberry32(7);
    const scoresA = Array.from({ length: 400 }, () => random());
    const scoresB = scoresA.map((value) => value + 0.05 + (random() - 0.5) * 0.4);
    const result = evalCompare({ scoresA, scoresB, bootstrapSamples: 4000, seed: 3 });
    const [low, high] = result.bootstrap.confidenceInterval;
    expect(low).toBeCloseTo(result.meanDifference - 1.96 * result.standardError, 2);
    expect(high).toBeCloseTo(result.meanDifference + 1.96 * result.standardError, 2);
    expect(result.bootstrap.pValue).toBeLessThan(0.001);
  });

  it("is reproducible for a fixed seed and varies across seeds", () => {
    const scoresA = [0.1, 0.4, 0.35, 0.8, 0.5, 0.65];
    const scoresB = [0.2, 0.3, 0.5, 0.9, 0.45, 0.7];
    const first = evalCompare({ scoresA, scoresB, seed: 42, bootstrapSamples: 1000 });
    const second = evalCompare({ scoresA, scoresB, seed: 42, bootstrapSamples: 1000 });
    const other = evalCompare({ scoresA, scoresB, seed: 43, bootstrapSamples: 1000 });
    expect(second).toEqual(first);
    expect(other.bootstrap.confidenceInterval).not.toEqual(first.bootstrap.confidenceInterval);
  });

  it("includes McNemar for binary scores and favors the better model", () => {
    const { a, b } = contingency(50, 2, 10, 8);
    const result = evalCompare({ scoresA: a, scoresB: b, confidenceLevel: 0.9 });
    expect(result.mcnemar?.exactPValue).toBeCloseTo(158 / 4096, 12);
    expect(result.meanDifference).toBeCloseTo(8 / 70, 12);
    expect(result.bootstrap.confidenceLevel).toBe(0.9);
    const reversed = evalCompare({ scoresA: b, scoresB: a });
    expect(reversed.interpretation).toMatch(/Model A scores higher/);
    expect(reversed.winsA).toBe(10);
  });

  it("validates its input", () => {
    expect(() => evalCompare({ scoresA: [1, 2], scoresB: [1] })).toThrow(/same length/);
    expect(() => evalCompare({ scoresA: [1], scoresB: [1] })).toThrow(/at least two/);
    expect(() => evalCompare({ scoresA: [1, Number.NaN], scoresB: [1, 2] })).toThrow(
      ToolInputError,
    );
    expect(() => evalCompare({ scoresA: [1, 2], scoresB: [1, Number.POSITIVE_INFINITY] })).toThrow(
      /scoresB\[1\]/,
    );
    const big = new Array<number>(5000).fill(0);
    expect(() => evalCompare({ scoresA: big, scoresB: big, bootstrapSamples: 100_000 })).toThrow(
      /at most/,
    );
  });
});

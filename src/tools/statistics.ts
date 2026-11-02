import { mulberry32 } from "../random.js";
import { ToolInputError } from "../errors.js";

export interface EvalCompareOptions {
  scoresA: number[];
  scoresB: number[];
  bootstrapSamples?: number | undefined;
  confidenceLevel?: number | undefined;
  seed?: number | undefined;
}

export interface McNemarResult {
  /** A correct, B incorrect. */
  onlyACorrect: number;
  /** A incorrect, B correct. */
  onlyBCorrect: number;
  bothCorrect: number;
  bothIncorrect: number;
  chiSquareStatistic: number;
  chiSquarePValue: number;
  exactPValue: number;
  recommendedPValue: number;
  recommendedMethod: "exact-binomial" | "chi-square-continuity-corrected";
}

export interface EvalCompareResult {
  n: number;
  meanA: number;
  meanB: number;
  /** mean(B) minus mean(A): positive values favor model B. */
  meanDifference: number;
  standardError: number;
  bootstrap: {
    samples: number;
    seed: number;
    confidenceLevel: number;
    confidenceInterval: [number, number];
    pValue: number;
  };
  winsB: number;
  winsA: number;
  ties: number;
  mcnemar: McNemarResult | null;
  interpretation: string;
}

const MAX_WORK = 200_000_000;

export function mean(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return values.length === 0 ? 0 : total / values.length;
}

/** Linear-interpolation quantile (the default "type 7" definition used by R and NumPy). */
export function quantile(sorted: readonly number[], probability: number): number {
  if (sorted.length === 0) {
    throw new RangeError("quantile of an empty array");
  }
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower] as number;
  const upperValue = sorted[upper] as number;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

/** Complementary error function (Numerical Recipes erfcc, fractional error below 1.2e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Upper tail probability of a chi-square distribution with one degree of freedom. */
export function chiSquareOneDegreeSurvival(statistic: number): number {
  if (statistic <= 0) {
    return 1;
  }
  return erfc(Math.sqrt(statistic / 2));
}

/** P(X <= k) for X ~ Binomial(n, 0.5). */
export function binomialHalfCdf(k: number, n: number): number {
  if (k < 0) {
    return 0;
  }
  if (k >= n) {
    return 1;
  }
  // Accumulate log C(n, i) incrementally, which is exact up to floating point rounding.
  const logHalfPower = -n * Math.LN2;
  let logCombination = 0;
  let total = Math.exp(logHalfPower);
  for (let i = 1; i <= k; i++) {
    logCombination += Math.log(n - i + 1) - Math.log(i);
    total += Math.exp(logCombination + logHalfPower);
  }
  return Math.min(1, total);
}

export function mcnemar(scoresA: readonly number[], scoresB: readonly number[]): McNemarResult {
  let onlyACorrect = 0;
  let onlyBCorrect = 0;
  let bothCorrect = 0;
  let bothIncorrect = 0;
  scoresA.forEach((a, index) => {
    const b = scoresB[index];
    if (a === 1 && b === 1) bothCorrect++;
    else if (a === 1) onlyACorrect++;
    else if (b === 1) onlyBCorrect++;
    else bothIncorrect++;
  });
  const discordant = onlyACorrect + onlyBCorrect;
  const chiSquareStatistic =
    discordant === 0 ? 0 : (Math.abs(onlyACorrect - onlyBCorrect) - 1) ** 2 / discordant;
  const chiSquarePValue = discordant === 0 ? 1 : chiSquareOneDegreeSurvival(chiSquareStatistic);
  const exactPValue =
    discordant === 0
      ? 1
      : Math.min(1, 2 * binomialHalfCdf(Math.min(onlyACorrect, onlyBCorrect), discordant));
  const useExact = discordant < 25;
  return {
    onlyACorrect,
    onlyBCorrect,
    bothCorrect,
    bothIncorrect,
    chiSquareStatistic,
    chiSquarePValue,
    exactPValue,
    recommendedPValue: useExact ? exactPValue : chiSquarePValue,
    recommendedMethod: useExact ? "exact-binomial" : "chi-square-continuity-corrected",
  };
}

function validateScores(name: string, values: readonly number[]): void {
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      throw new ToolInputError(`${name}[${index}] is not a finite number`);
    }
  });
}

export function evalCompare(options: EvalCompareOptions): EvalCompareResult {
  const { scoresA, scoresB } = options;
  const samples = options.bootstrapSamples ?? 10_000;
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  const seed = options.seed ?? 0;
  if (scoresA.length !== scoresB.length) {
    throw new ToolInputError(
      `scoresA and scoresB must be paired (same length); got ${scoresA.length} and ${scoresB.length}`,
    );
  }
  if (scoresA.length < 2) {
    throw new ToolInputError("at least two paired examples are required");
  }
  validateScores("scoresA", scoresA);
  validateScores("scoresB", scoresB);
  if (scoresA.length * samples > MAX_WORK) {
    throw new ToolInputError(
      `n * bootstrapSamples must be at most ${MAX_WORK}; reduce bootstrapSamples`,
    );
  }

  const n = scoresA.length;
  const differences = scoresB.map((b, index) => b - (scoresA[index] as number));
  const meanDifference = mean(differences);
  let squared = 0;
  for (const d of differences) {
    squared += (d - meanDifference) ** 2;
  }
  const standardError = Math.sqrt(squared / (n - 1)) / Math.sqrt(n);

  const random = mulberry32(seed);
  const resampledMeans = new Float64Array(samples);
  let extreme = 0;
  const observed = Math.abs(meanDifference);
  for (let s = 0; s < samples; s++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += differences[Math.floor(random() * n)] as number;
    }
    const resampledMean = total / n;
    resampledMeans[s] = resampledMean;
    // Shifting by the observed mean imposes the null hypothesis of zero mean difference.
    if (Math.abs(resampledMean - meanDifference) >= observed - 1e-12) {
      extreme++;
    }
  }
  const sorted = Array.from(resampledMeans).sort((x, y) => x - y);
  const alpha = 1 - confidenceLevel;
  const confidenceInterval: [number, number] = [
    quantile(sorted, alpha / 2),
    quantile(sorted, 1 - alpha / 2),
  ];
  const pValue = (extreme + 1) / (samples + 1);

  let winsA = 0;
  let winsB = 0;
  let ties = 0;
  for (const d of differences) {
    if (d > 0) winsB++;
    else if (d < 0) winsA++;
    else ties++;
  }

  const binary = [...scoresA, ...scoresB].every((value) => value === 0 || value === 1);
  const mcnemarResult = binary ? mcnemar(scoresA, scoresB) : null;

  const percent = Math.round(confidenceLevel * 1000) / 10;
  const excludesZero = confidenceInterval[0] > 0 || confidenceInterval[1] < 0;
  const interpretation = excludesZero
    ? `Model ${meanDifference > 0 ? "B" : "A"} scores higher; the ${percent}% bootstrap interval ` +
      "for mean(B) - mean(A) excludes zero."
    : `No reliable difference: the ${percent}% bootstrap interval for mean(B) - mean(A) includes zero.`;

  return {
    n,
    meanA: mean(scoresA),
    meanB: mean(scoresB),
    meanDifference,
    standardError,
    bootstrap: { samples, seed, confidenceLevel, confidenceInterval, pValue },
    winsA,
    winsB,
    ties,
    mcnemar: mcnemarResult,
    interpretation,
  };
}

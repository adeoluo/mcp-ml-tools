# 0004: Paired bootstrap with a centered null, plus McNemar for binary scores

## Status

Accepted

## Context

Comparing two models on the same evaluation set is a paired problem. Treating the two score lists as
independent samples overstates uncertainty and wastes the pairing.

## Decision

- Work with per-example differences `d = B - A`.
- Confidence interval: percentile bootstrap of `mean(d)`, resampling examples with replacement,
  using linear-interpolation quantiles (the NumPy default).
- p-value: two-sided bootstrap test of zero mean difference. The resampled means are centered on the
  observed mean (which imposes the null), and the p-value is
  `(1 + count(|resampled - observed| >= |observed|)) / (1 + samples)`, so it is never exactly zero.
- When every score is 0 or 1, also report McNemar's test: the exact two-sided binomial test on the
  discordant pairs (recommended below 25 discordant pairs) and the continuity-corrected chi-square
  statistic.
- Randomness comes from a seeded Mulberry32 generator, so identical inputs give identical output.

## Consequences

- Results are reproducible and checked in tests against hand-computed values and Python's
  `math.erfc` reference values.
- The bootstrap is approximate for very small samples; with fewer than about 20 examples prefer the
  exact McNemar result for binary scores, and treat intervals as rough.

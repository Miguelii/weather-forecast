/**
 * Computes the arithmetic mean of an array of numbers.
 *
 * @param values - Array of numeric values.
 * @returns The mean, or `null` if the array is empty.
 *
 * @example
 * mean([10, 20, 30]) // 20
 * mean([])           // null
 */
export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Computes the sample standard deviation (divided by n-1) of an array of numbers.
 *
 * The sample formula is used instead of the population formula to produce
 * more accurate results with small model sets (typically 2–4 models).
 *
 * @param values - Array of numeric values.
 * @returns The standard deviation, or `0` if fewer than 2 values are provided.
 *
 * @example
 * stddev([18, 20, 22]) // ~2
 * stddev([18])         // 0
 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values) as number;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Returns the value at a given percentile from a **pre-sorted** array.
 *
 * Uses linear interpolation between adjacent values when the index is not
 * a whole number — the same method used by Excel and most meteorological
 * systems.
 *
 * @param sortedValues - Array of numbers sorted in ascending order.
 * @param p - Target percentile between 0 and 100 (e.g. 10, 50, 90).
 * @returns The value at percentile `p`, or `null` if the array is empty.
 *
 * @example
 * percentile([10, 20, 30, 40], 50) // 25  (interpolated median)
 * percentile([10, 20, 30, 40], 25) // 17.5
 */
export function percentile(sortedValues: number[], p: number): number | null {
  if (!sortedValues.length) return null;
  const idx = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return (
    (sortedValues[lo] as number) +
    (idx - lo) * ((sortedValues[hi] as number) - (sortedValues[lo] as number))
  );
}

/**
 * Approximation of the error function (erf) using the Abramowitz & Stegun method.
 * Maximum error: 1.5 × 10⁻⁷.
 *
 * Used internally by `normalCDF` to compute cumulative probabilities.
 *
 * @param input - Input value.
 * @returns erf(input) in the range [-1, 1].
 */
function erf(input: number): number {
  const sign = input >= 0 ? 1 : -1;
  const abs = Math.abs(input);
  const t = 1 / (1 + 0.3275911 * abs);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-abs * abs);
  return sign * y;
}

/**
 * Cumulative distribution function (CDF) of the normal distribution.
 * Computes P(X ≤ x) given X ~ N(mu, sigma²).
 *
 * Used to convert the model ensemble into a probability:
 * e.g. P(max temperature > 25°C) = 1 − normalCDF(25, mean, spread).
 *
 * @param x - Threshold value (e.g. a temperature limit).
 * @param mu - Mean of the distribution (e.g. ensemble mean).
 * @param sigma - Standard deviation of the distribution (e.g. model spread).
 * @returns Probability P(X ≤ x) in the range [0, 1].
 *
 * @example
 * normalCDF(20, 20, 2) // 0.5    — 50% chance of staying below 20°C
 * normalCDF(24, 20, 2) // ~0.977
 */
export function normalCDF(x: number, mu: number, sigma: number): number {
  if (sigma === 0) return x >= mu ? 1 : 0;
  const z = (x - mu) / (sigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

// Coefficients for Acklam's rational approximation of the inverse normal CDF.
const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
];
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
];
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
];
const ACKLAM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const ACKLAM_P_LOW = 0.02425;

/**
 * Standard-normal quantile function (probit) — the inverse of the standard normal CDF.
 *
 * Uses Peter Acklam's rational approximation (relative error < 1.15 × 10⁻⁹), avoiding a
 * dependency just to invert the normal. Used by {@link invNormalCDF}.
 *
 * @param p - Probability in the open interval (0, 1).
 * @returns The z-score such that `normalCDF(z, 0, 1) ≈ p`.
 */
function probit(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  if (p < ACKLAM_P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q + ACKLAM_C[4]) *
        q +
        ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1)
    );
  }

  if (p > 1 - ACKLAM_P_LOW) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        ((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q +
          ACKLAM_C[4]) *
          q +
        ACKLAM_C[5]
      ) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1)
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((ACKLAM_A[0] * r + ACKLAM_A[1]) * r + ACKLAM_A[2]) * r + ACKLAM_A[3]) * r + ACKLAM_A[4]) *
      r +
      ACKLAM_A[5]) *
      q) /
    (((((ACKLAM_B[0] * r + ACKLAM_B[1]) * r + ACKLAM_B[2]) * r + ACKLAM_B[3]) * r + ACKLAM_B[4]) *
      r +
      1)
  );
}

/**
 * Inverse normal CDF: the value `x` such that `P(X ≤ x) = p` for `X ~ N(mu, sigma²)`.
 *
 * Lets the deterministic (normal-fit) path derive percentiles that are consistent with the
 * same calibrated `sigma` used for the threshold probabilities — instead of reading them off
 * only 4 model points, which understates the spread.
 *
 * @param p - Target probability in (0, 1) (e.g. 0.1, 0.5, 0.9).
 * @param mu - Mean of the distribution.
 * @param sigma - Standard deviation of the distribution.
 * @returns The quantile value; equals `mu` when `sigma` is 0.
 *
 * @example
 * invNormalCDF(0.5, 20, 2) // 20
 * invNormalCDF(0.9, 20, 2) // ~22.56
 */
export function invNormalCDF(p: number, mu: number, sigma: number): number {
  if (sigma === 0) return mu;
  return mu + sigma * probit(p);
}

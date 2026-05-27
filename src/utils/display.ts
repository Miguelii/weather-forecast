import Table from 'cli-table3';
import type {
  BetRecommendation,
  BiasStore,
  CorrectedForecast,
  EnsembleResult,
  Location,
  PolymarketLine,
  ProbabilityResult,
} from '#types.js';
import { MIN_BET_EDGE_PERCENT } from '#utils/constants.js';

/** Formats a nullable temperature value for table display (e.g. `"22°C"` or `"n/a"`). */
const fmt = (v: number | null): string => (v !== null ? `${v}°C` : 'n/a');

/** Formats a bias value with explicit sign for table display (e.g. `"+1.5"` or `"-0.5"`). */
const fmtBias = (b: number): string => {
  if (b === 0) return '  0.0';
  return b > 0 ? `+${b}` : `${b}`;
};

/**
 * Computes a bet recommendation for each Polymarket line by comparing the market's
 * YES price against the model's estimated probability.
 *
 * The model probability formula varies by market kind:
 * - `above`: `P(max > X)` = `probAbove(X)`
 * - `below`: `P(max ≤ X)` = `100 − probAbove(X)`
 * - `exact`: `P(max ≈ X bucket)` = `probAbove(X−1) − probAbove(X)`
 *
 * @param lines - Parsed Polymarket market lines (including `kind` metadata).
 * @param probs - Model-computed probabilities from the voting system.
 * @returns Array of {@link BetRecommendation} objects, one per line.
 */
export function buildRecommendations(
  lines: PolymarketLine[],
  probs: ProbabilityResult[],
): BetRecommendation[] {
  return lines.map((line) => {
    const match = probs.find((p) => p.threshold === line.threshold);

    // Compute model probability according to the market's semantics:
    //   above → P(max > X)              = probAbove(X)
    //   below → P(max ≤ X)              = 100 - probAbove(X)
    //   exact → P(max in [X, X+1) bucket) ≈ probAbove(X-1) - probAbove(X)
    let modelProb: number;
    if (!match) {
      modelProb = NaN;
    } else if (line.kind === 'above') {
      modelProb = match.probAbove;
    } else if (line.kind === 'below') {
      modelProb = 100 - match.probAbove;
    } else {
      // exact: need the probAbove for the previous integer threshold
      const prev = probs.find((p) => p.threshold === line.threshold - 1);
      modelProb = prev ? prev.probAbove - match.probAbove : NaN;
    }

    const edge = Number.isNaN(modelProb) ? NaN : modelProb - line.yesProb;
    let signal: BetRecommendation['signal'] = 'SKIP';
    if (!Number.isNaN(edge)) {
      if (edge >= MIN_BET_EDGE_PERCENT) signal = 'YES';
      else if (edge <= -MIN_BET_EDGE_PERCENT) signal = 'NO';
    }
    return { threshold: line.threshold, modelProb, marketYesProb: line.yesProb, edge, signal };
  });
}

/** Formats an edge value as a signed percentage string (e.g. `"+21.5%"` or `"-7.0%"`). */
export function fmtEdge(edge: number): string {
  if (Number.isNaN(edge)) return 'N/A';
  const sign = edge >= 0 ? '+' : '';
  return `${sign}${edge.toFixed(1)}%`;
}

/** Formats a bet signal enum value for table display. */
function fmtSignal(signal: BetRecommendation['signal']): string {
  if (signal === 'YES') return 'BET YES';
  if (signal === 'NO') return 'BET NO';
  return '—  skip';
}

/**
 * Prints the Polymarket vs. model analysis table and best-opportunity summary to stdout.
 *
 * @param lines - Parsed Polymarket market lines (with `kind`: below / exact / above).
 * @param probs - Model-computed probabilities from the voting system.
 */
function printPolymarketAnalysis(lines: PolymarketLine[], probs: ProbabilityResult[]): void {
  const recs = buildRecommendations(lines, probs);

  console.log('\n Polymarket vs. Model Analysis');
  console.log('─────────────────────────────────────────────────────');

  const table = new Table({
    head: ['Threshold', 'Type', 'Market YES', 'Model Est.', 'Edge', 'Signal'],
    colAligns: ['right', 'left', 'right', 'right', 'right', 'left'],
    style: { head: ['cyan'] },
  });

  for (const r of recs) {
    const line = lines.find((l) => l.threshold === r.threshold);
    const kindLabel = line ? line.kind.toUpperCase() : '';
    table.push([
      `${r.threshold}°C`,
      kindLabel,
      `${r.marketYesProb.toFixed(1)}%`,
      Number.isNaN(r.modelProb) ? 'N/A' : `${r.modelProb.toFixed(1)}%`,
      fmtEdge(r.edge),
      fmtSignal(r.signal),
    ]);
  }
  console.log(table.toString());

  const best = recs
    .filter((r) => r.signal !== 'SKIP' && !Number.isNaN(r.edge))
    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];

  if (best) {
    const bestLine = lines.find((l) => l.threshold === best.threshold);
    let kindDesc: string;
    if (bestLine?.kind === 'below') {
      kindDesc = `max ≤ ${best.threshold}°C`;
    } else if (bestLine?.kind === 'exact') {
      kindDesc = `max = ${best.threshold}°C`;
    } else {
      kindDesc = `max > ${best.threshold}°C`;
    }
    console.log(
      ` Best opportunity: BET ${best.signal} on ${kindDesc}  [edge: ${fmtEdge(best.edge)}]`,
    );
  } else {
    console.log(' No clear edge — market prices appear aligned with the model.');
  }
  console.log('\n');
}

/**
 * Prints the full forecast report to stdout: model table, ensemble summary, percentile
 * table, probability bars, and (optionally) Polymarket analysis.
 *
 * @param location - Resolved city location with coordinates and display name.
 * @param date - Target date string in `YYYY-MM-DD` format.
 * @param corrected - Bias-corrected forecasts from all NWP models.
 * @param ensemble - Ensemble statistics computed by the voting system.
 * @param polymarketLines - Optional Polymarket odds; if provided, appends the analysis section.
 */
export function printForecastOutput(
  location: Location,
  date: string,
  corrected: CorrectedForecast[],
  ensemble: EnsembleResult,
  polymarketLines?: PolymarketLine[],
): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Weather Ensemble Forecast');
  console.log(` City:  ${location.name}, ${location.country}`);
  console.log(` Date:  ${date}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const modelTable = new Table({
    head: ['Model', 'Raw Max', 'Raw Min', 'Raw Mean', 'Bias', 'Corr Max', 'Corr Min', 'Corr Mean'],
    colAligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
    style: { head: ['cyan'] },
  });

  for (const f of corrected) {
    if (f.error) {
      modelTable.push([f.model.toUpperCase(), { colSpan: 7, content: `ERROR: ${f.error}` }]);
    } else {
      modelTable.push([
        f.model.toUpperCase(),
        fmt(f.rawTempMax),
        fmt(f.rawTempMin),
        fmt(f.rawTempMean),
        fmtBias(f.bias),
        fmt(f.tempMax),
        fmt(f.tempMin),
        fmt(f.tempMean),
      ]);
    }
  }
  console.log(modelTable.toString());

  console.log('\n Ensemble — Daily Max Temperature');
  console.log('─────────────────────────────────────────────────────');
  console.log(` Forecast max:  ${ensemble.maxMean}°C   |   Spread (σ): ±${ensemble.maxSpread}°C`);
  if (ensemble.minMean !== null) {
    console.log(` Forecast min:  ${ensemble.minMean}°C`);
  }
  console.log(
    ` Models used: ${ensemble.modelsUsed}/${ensemble.modelsUsed + ensemble.modelsFailed}${ensemble.modelsFailed ? `  (${ensemble.modelsFailed} failed)` : ''}`,
  );

  const { p10, p25, p50, p75, p90 } = ensemble.maxPercentiles;
  const pctTable = new Table({
    head: ['P10', 'P25', 'P50 (median)', 'P75', 'P90'],
    colAligns: ['right', 'right', 'right', 'right', 'right'],
    style: { head: ['cyan'] },
  });
  pctTable.push([`${p10}°C`, `${p25}°C`, `${p50}°C`, `${p75}°C`, `${p90}°C`]);
  console.log('\n Max temperature percentiles');
  console.log(pctTable.toString());

  console.log(' P10 = cold scenario (90% chance of being warmer)');
  console.log(' P50 = median');
  console.log(' P90 = warm scenario (10% chance of being warmer)');

  if (ensemble.probabilities.length) {
    console.log('\n Probabilities — P(max temp > X)');
    console.log('─────────────────────────────────────────────────────');
    for (const { threshold, probAbove } of ensemble.probabilities) {
      const bar = '█'.repeat(Math.round(probAbove / 5)).padEnd(20, '░');
      console.log(`  P(max > ${threshold}°C):  ${bar} ${probAbove}%`);
    }
  }

  if (polymarketLines?.length) {
    printPolymarketAnalysis(polymarketLines, ensemble.probabilities);
  } else {
    console.log('\n');
  }
}

/**
 * Prints all stored bias corrections as a formatted table to stdout.
 *
 * @param data - The full bias store to display.
 */
export function printBiasTable(data: BiasStore): void {
  const entries = Object.entries(data);
  if (!entries.length) {
    console.log('No bias corrections stored yet.');
    return;
  }

  const table = new Table({
    head: ['City', 'Model', 'Bias (°C)'],
    style: { head: ['cyan'] },
  });
  for (const [city, models] of entries) {
    for (const [model, biasValue] of Object.entries(models ?? {})) {
      table.push([city, model.toUpperCase(), biasValue]);
    }
  }
  console.log(table.toString());
}

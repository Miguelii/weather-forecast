import Table from 'cli-table3';
import type {
  BiasStore,
  CorrectedForecast,
  DayConditions,
  EnsembleResult,
  Location,
} from '#types.js';

/** Formats a nullable temperature value for table display (e.g. `"22°C"` or `"n/a"`). */
const fmt = (v: number | null): string => (v !== null ? `${v}°C` : 'n/a');

/** Formats a nullable numeric metric with a unit suffix (e.g. `"45%"` or `"n/a"`). */
const fmtUnit = (v: number | null, unit: string): string => (v !== null ? `${v}${unit}` : 'n/a');

/** Formats a bias value with explicit sign for table display (e.g. `"+1.5"` or `"-0.5"`). */
const fmtBias = (b: number): string => {
  if (b === 0) return '  0.0';
  return b > 0 ? `+${b}` : `${b}`;
};

/**
 * Prints the full forecast report to stdout: model table, ensemble summary, regime/conditions,
 * percentile table, and probability bars.
 *
 * @param location - Resolved city location with coordinates and display name.
 * @param date - Target date string in `YYYY-MM-DD` format.
 * @param corrected - Bias-corrected forecasts from all NWP models.
 * @param ensemble - Ensemble statistics computed by the voting system.
 * @param conditions - Summarised atmospheric conditions, or null if unavailable.
 */
export function printForecastOutput(
  location: Location,
  date: string,
  corrected: CorrectedForecast[],
  ensemble: EnsembleResult,
  conditions: DayConditions | null,
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
    ` Models used: ${ensemble.modelsUsed}/${ensemble.modelsUsed + ensemble.modelsFailed}${ensemble.modelsFailed ? `  (${ensemble.modelsFailed} failed)` : ''}${ensemble.membersUsed ? `  |  members: ${ensemble.membersUsed}` : ''}`,
  );
  console.log(` Regime: ${ensemble.regime.kind.toUpperCase()} — ${ensemble.regime.reason}`);
  if (conditions) {
    console.log(
      ` Conditions: CAPE ${fmtUnit(conditions.capeMaxMidday, ' J/kg')} | cloud ${fmtUnit(conditions.cloudCoverMeanMidday, '%')} | precip ${fmtUnit(conditions.precipProbabilityMax, '%')} | radiation ${fmtUnit(conditions.shortwaveRadiationSum, ' MJ/m²')}`,
    );
  }

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

  console.log('\n');
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

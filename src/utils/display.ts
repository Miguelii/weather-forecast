import Table from 'cli-table3';
import type { BiasStore, CorrectedForecast, EnsembleResult, Location } from '../types.js';

const fmt = (v: number | null): string => (v !== null ? `${v}°C` : 'n/a');

const fmtBias = (b: number): string => {
  if (b === 0) return '  0.0';
  return b > 0 ? `+${b}` : `${b}`;
};

export function printForecastOutput(
  location: Location,
  date: string,
  corrected: CorrectedForecast[],
  ensemble: EnsembleResult,
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

  console.log('\n Ensemble — Temperatura Máxima do Dia');
  console.log('─────────────────────────────────────────────────────');
  console.log(` Máx. prevista:  ${ensemble.maxMean}°C   |   Spread (σ): ±${ensemble.maxSpread}°C`);
  if (ensemble.minMean !== null) {
    console.log(` Mín. prevista:  ${ensemble.minMean}°C`);
  }
  console.log(
    ` Models used: ${ensemble.modelsUsed}/4${ensemble.modelsFailed ? `  (${ensemble.modelsFailed} failed)` : ''}`,
  );

  const { p10, p25, p50, p75, p90 } = ensemble.maxPercentiles;
  const pctTable = new Table({
    head: ['P10', 'P25', 'P50 (mediana)', 'P75', 'P90'],
    colAligns: ['right', 'right', 'right', 'right', 'right'],
    style: { head: ['cyan'] },
  });
  pctTable.push([`${p10}°C`, `${p25}°C`, `${p50}°C`, `${p75}°C`, `${p90}°C`]);
  console.log('\n Percentagem da temperatura máxima');
  console.log(pctTable.toString());

  if (ensemble.probabilities.length) {
    console.log('\n Probabilidades — P(temp máx > X)');
    console.log('─────────────────────────────────────────────────────');
    for (const { threshold, probAbove } of ensemble.probabilities) {
      const bar = '█'.repeat(Math.round(probAbove / 5)).padEnd(20, '░');
      console.log(`  P(máx > ${threshold}°C):  ${bar} ${probAbove}%`);
    }
  }

  console.log('\n');
}

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

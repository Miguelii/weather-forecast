import { Command } from 'commander';
import Table from 'cli-table3';
import { resolveCity } from './utils/geocoding.js';
import { fetchAllModels } from './fetchers/openMeteo.js';
import { correctForecast } from './bias/apply.js';
import { loadBias, setBias } from './bias/store.js';
import { runVotingSystem } from './voting/voting-system.js';
import type { ModelId } from './types.js';
import { DATE_RE, MAX_FORECAST_DAYS } from './utils/constants.js';

function validateDate(date: string): void {
  if (!DATE_RE.test(date)) {
    console.error(`Error: --date must be in YYYY-MM-DD format (got "${date}")`);
    process.exit(1);
  }
  const daysDiff = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (daysDiff < -1) {
    console.warn(
      '⚠️  Data no passado — os modelos não têm dados históricos, podem devolver nulos.',
    );
  }
  if (daysDiff > MAX_FORECAST_DAYS) {
    console.warn(
      `⚠️  Data além de ${MAX_FORECAST_DAYS} dias — modelos podem não ter dados para essa data.`,
    );
  }
}

const program = new Command();
program.name('polly-bot').description('Weather ensemble forecast for Polymarket').version('1.0.0');

// ─── forecast ────────────────────────────────────────────────────────────────
program
  .command('forecast')
  .description('Run ensemble forecast for a city on a given date')
  .requiredOption('--city <name>', 'City name (e.g. "London")')
  .requiredOption('--date <YYYY-MM-DD>', 'Target date')
  .option('--threshold <temps>', 'Comma-separated temperature thresholds (e.g. "18,20,22")')
  .action(async (opts: { city: string; date: string; threshold?: string }) => {
    try {
      validateDate(opts.date);

      const thresholds = opts.threshold
        ? opts.threshold
            .split(',')
            .map((t) => Number.parseFloat(t.trim()))
            .filter((t) => !Number.isNaN(t))
        : [];

      // Load bias store once — avoids 4 separate file reads (one per model)
      const [location, biasStore] = await Promise.all([resolveCity(opts.city), loadBias()]);
      console.log(
        `\nLocation: ${location.name}, ${location.country} (${location.lat}, ${location.lon})`,
      );

      process.stdout.write('Fetching forecasts from IFS, AIFS, GFS, ICON...\n');
      const raw = await fetchAllModels(location.lat, location.lon, opts.date);

      const corrected = raw.map((f) => correctForecast(f, location.name, biasStore));
      const ensemble = runVotingSystem(corrected, thresholds);

      // ── Model table ──────────────────────────────────────────────────────
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(' Weather Ensemble Forecast');
      console.log(` City:  ${location.name}, ${location.country}`);
      console.log(` Date:  ${opts.date}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const modelTable = new Table({
        head: [
          'Model',
          'Raw Max',
          'Raw Min',
          'Raw Mean',
          'Bias',
          'Corr Max',
          'Corr Min',
          'Corr Mean',
        ],
        colAligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        style: { head: ['cyan'] },
      });

      const fmt = (v: number | null): string => (v !== null ? `${v}°C` : 'n/a');
      const fmtBias = (b: number): string => {
        if (b === 0) return '  0.0';
        return b > 0 ? `+${b}` : `${b}`;
      };

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

      // ── Ensemble result ──────────────────────────────────────────────────
      console.log('\n Ensemble — Temperatura Máxima do Dia');
      console.log('─────────────────────────────────────────────────────');
      console.log(
        ` Máx. prevista:  ${ensemble.maxMean}°C   |   Spread (σ): ±${ensemble.maxSpread}°C`,
      );
      if (ensemble.minMean !== null) {
        console.log(` Mín. prevista:  ${ensemble.minMean}°C`);
      }
      console.log(
        ` Models used: ${ensemble.modelsUsed}/4${ensemble.modelsFailed ? `  (${ensemble.modelsFailed} failed)` : ''}`,
      );

      // ── Percentis da temp. máxima ────────────────────────────────────────
      const { p10, p25, p50, p75, p90 } = ensemble.maxPercentiles;
      const pctTable = new Table({
        head: ['P10', 'P25', 'P50 (mediana)', 'P75', 'P90'],
        colAligns: ['right', 'right', 'right', 'right', 'right'],
        style: { head: ['cyan'] },
      });
      pctTable.push([`${p10}°C`, `${p25}°C`, `${p50}°C`, `${p75}°C`, `${p90}°C`]);
      console.log('\n Percentagem da temperatura máxima');
      console.log(pctTable.toString());

      // ── Probabilidades da temp. máxima ───────────────────────────────────
      if (ensemble.probabilities.length) {
        console.log('\n Probabilidades — P(temp máx > X)');
        console.log('─────────────────────────────────────────────────────');
        for (const { threshold, probAbove } of ensemble.probabilities) {
          const bar = '█'.repeat(Math.round(probAbove / 5)).padEnd(20, '░');
          console.log(`  P(máx > ${threshold}°C):  ${bar} ${probAbove}%`);
        }
      }

      console.log('\n');
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── bias ─────────────────────────────────────────────────────────────────────
const biasCmd = program.command('bias').description('Manage model bias corrections');

biasCmd
  .command('set')
  .description('Set bias correction for a model in a city')
  .requiredOption('--city <name>', 'City name (must match the resolved name)')
  .requiredOption('--model <id>', 'Model id: ifs | aifs | gfs | icon')
  .requiredOption('--value <number>', 'Bias value in °C (subtracted from raw forecast)')
  .action(async (opts: { city: string; model: string; value: string }) => {
    const value = Number.parseFloat(opts.value);
    if (Number.isNaN(value)) {
      console.error('--value must be a number');
      process.exit(1);
    }
    const validModels: ModelId[] = ['ifs', 'aifs', 'gfs', 'icon'];
    const model = opts.model.toLowerCase() as ModelId;
    if (!validModels.includes(model)) {
      console.error(`--model must be one of: ${validModels.join(', ')}`);
      process.exit(1);
    }
    await setBias(opts.city, model, value);
    console.log(`Bias set: ${opts.city} / ${model} = ${value}°C`);
  });

biasCmd
  .command('list')
  .description('List all stored bias corrections')
  .action(async () => {
    const data = await loadBias();
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
      for (const [model, value] of Object.entries(models ?? {})) {
        table.push([city, model.toUpperCase(), value]);
      }
    }
    console.log(table.toString());
  });

program.parse();

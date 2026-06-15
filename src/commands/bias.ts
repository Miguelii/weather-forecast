import type { Command } from 'commander';
import { Effect } from 'effect';
import { loadBias, saveBias, setBias } from '#bias/store.js';
import { loadCalibration, saveCalibration } from '#bias/calibrationStore.js';
import { computeCalibrationFromLog } from '#bias/computeBias.js';
import { readForecastLog } from '#utils/forecastLog.js';
import type { BiasStore, ModelId } from '#types.js';
import { DEFAULT_BIAS_WINDOW_DAYS } from '#utils/constants.js';
import { printBiasTable } from '#utils/display.js';
import { runOrExit } from '#utils/runOrExit.js';

const VALID_MODELS: ModelId[] = ['ifs', 'gfs', 'icon', 'gem'];

/** Merges computed per-city/model bias over an existing store, preserving untouched pairs. */
function mergeBias(existing: BiasStore, computed: BiasStore): BiasStore {
  const merged: BiasStore = { ...existing };
  for (const [city, models] of Object.entries(computed)) {
    merged[city] = { ...existing[city], ...models };
  }
  return merged;
}

/**
 * Registers the `bias` command group and its sub-commands (`set`, `list`, `compute`) on the CLI.
 *
 * @param cli - The root Commander instance to attach the command to.
 */
export function registerBiasCommand(cli: Command): void {
  const biasCmd = cli.command('bias').description('Manage model bias corrections');

  biasCmd
    .command('set')
    .description('Set bias correction for a model in a city')
    .requiredOption('--city <name>', 'City name (must match the resolved name)')
    .requiredOption('--model <id>', 'Model id: ifs | gem | gfs | icon')
    .requiredOption('--value <number>', 'Bias value in °C (subtracted from raw forecast)')
    .action((opts: { city: string; model: string; value: string }) => {
      const value = Number.parseFloat(opts.value);
      if (Number.isNaN(value)) {
        console.error('--value must be a number');
        process.exit(1);
      }

      const model = opts.model.toLowerCase() as ModelId;
      if (!VALID_MODELS.includes(model)) {
        console.error(`--model must be one of: ${VALID_MODELS.join(', ')}`);
        process.exit(1);
      }

      runOrExit(
        Effect.gen(function* () {
          yield* setBias(opts.city, model, value);
          console.log(`Bias set: ${opts.city} / ${model} = ${value}°C`);
        }),
      );
    });

  biasCmd
    .command('list')
    .description('List all stored bias corrections')
    .action(() => {
      runOrExit(
        Effect.gen(function* () {
          const data = yield* loadBias();
          printBiasTable(data);
        }),
      );
    });

  biasCmd
    .command('compute')
    .description('Recompute bias.json + calibration.json from the recorded forecast log')
    .option(
      '--window <n>',
      'Trailing recorded days per city to average',
      String(DEFAULT_BIAS_WINDOW_DAYS),
    )
    .option('--dry-run', 'Print the computed values without writing any file')
    .action((opts: { window: string; dryRun?: boolean }) => {
      const window = Number.parseInt(opts.window, 10);
      if (Number.isNaN(window) || window <= 0) {
        console.error('--window must be a positive integer');
        process.exit(1);
      }

      runOrExit(
        Effect.gen(function* () {
          const entries = yield* readForecastLog();
          const { bias, calibration, perCity } = computeCalibrationFromLog(entries, window);

          const cities = Object.keys(perCity);
          if (!cities.length) {
            console.log(
              'No log entries with recorded outcomes yet. Run `record-actuals` for past dates first.',
            );
            return;
          }

          console.log(`Computed from the last ${window} recorded day(s) per city:`);
          for (const city of cities) {
            console.log(`  ${city}: ${perCity[city]} day(s)`);
          }

          console.log('\nBias (mean of raw − observed):');
          printBiasTable(bias);

          console.log('\nEmpirical RMSE (σ floor) per city:');
          for (const [city, rmse] of Object.entries(calibration)) {
            console.log(`  ${city}: ${rmse}°C`);
          }

          if (opts.dryRun) {
            console.log('\n(dry run — nothing written)');
            return;
          }

          const existingBias = yield* loadBias();
          yield* saveBias(mergeBias(existingBias, bias));

          const existingCalibration = yield* loadCalibration();
          yield* saveCalibration({ ...existingCalibration, ...calibration });

          console.log('\n✓ bias.json and calibration.json updated.');
        }),
      );
    });
}

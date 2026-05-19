import type { Command } from 'commander';
import { Effect } from 'effect';
import { loadBias, setBias } from '../bias/store.js';
import type { ModelId } from '../types.js';
import { printBiasTable } from '../utils/display.js';
import { runOrExit } from '../utils/runOrExit.js';

const VALID_MODELS: ModelId[] = ['ifs', 'gfs', 'icon', 'gem'];

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
}

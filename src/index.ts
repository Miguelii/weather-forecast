import { Command } from 'commander';
import { registerForecastAllCommand } from '#commands/forecastAll.js';
import { registerBiasCommand } from '#commands/bias.js';

const cli = new Command();
cli.name('polly-bot').description('Weather ensemble forecast for Polymarket').version('1.0.0');

registerForecastAllCommand(cli);
registerBiasCommand(cli);

cli.parse();

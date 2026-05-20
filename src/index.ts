import { Command } from 'commander';
import { registerForecastCommand } from '#commands/forecast.js';
import { registerBiasCommand } from '#commands/bias.js';
import { registerPolymarketCommand } from '#commands/polymarket.js';

const cli = new Command();
cli.name('polly-bot').description('Weather ensemble forecast for Polymarket').version('1.0.0');

registerForecastCommand(cli);
registerBiasCommand(cli);
registerPolymarketCommand(cli);

cli.parse();

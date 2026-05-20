import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { Effect } from 'effect';
import { PolymarketFetchError } from '#types.js';
import { fetchPolymarketEvent } from '#fetchers/polymarket.js';
import { PREDICTS_DIR } from '#utils/constants.js';
import { runOrExit } from '#utils/runOrExit.js';

// Matches the leading numeric part of a groupItemTitle like "23°C" or "23.5°C"
const TEMP_RE = /^([\d.]+)/;

/**
 * Parses a temperature value from a Polymarket market's `groupItemTitle`.
 * Returns `null` for non-numeric titles (e.g. "Below 20°C").
 */
function parseTempFromTitle(title: string): number | null {
  const m = TEMP_RE.exec(title.trim());
  if (!m) return null;
  const val = Number.parseFloat(m[1]);
  return Number.isNaN(val) ? null : val;
}

/**
 * Registers the `polymarket` command group and its sub-commands on the CLI.
 *
 * Currently exposes `polymarket fetch --url <URL>`, which fetches live odds from the
 * Polymarket Gamma API and saves them as a `predicts/` markdown file for use with
 * `forecast --polymarket`.
 *
 * @param cli - The root Commander instance to attach the command to.
 */
export function registerPolymarketCommand(cli: Command): void {
  const polymarket = cli
    .command('polymarket')
    .description('Fetch and manage Polymarket event odds');

  polymarket
    .command('fetch')
    .description('Fetch odds from a Polymarket event URL and save to a predicts/ file')
    .requiredOption('--url <url>', 'Polymarket event URL')
    .option('--output <path>', 'Output file path (default: predicts/<slug>.md)')
    .action((opts: { url: string; output?: string }) => {
      runOrExit(
        Effect.gen(function* () {
          // Extract slug from the last non-empty URL path segment
          const parsed = yield* Effect.try({
            try: () => new URL(opts.url),
            catch: () => new PolymarketFetchError({ cause: `Invalid URL: "${opts.url}"` }),
          });

          const rawSlug = parsed.pathname.split('/').filter(Boolean).at(-1);
          if (!rawSlug) {
            yield* new PolymarketFetchError({
              cause: `Cannot extract event slug from URL: "${opts.url}"`,
            });
          }
          // Effect runtime guarantees rawSlug is defined past this point;
          // the assertion communicates this to TypeScript's type checker.
          const slug = rawSlug as string;

          process.stdout.write(`Fetching Polymarket event: ${slug}\n`);

          const event = yield* fetchPolymarketEvent(slug);
          process.stdout.write(`Found: ${event.title}\n`);

          // Parse markets into threshold lines, skipping non-numeric titles.
          // outcomePrices is a JSON-encoded string: "[\"0.43\", \"0.57\"]"
          const rawMarkets = event.markets
            .reduce<{ temp: number; yesProb: number; noProb: number }[]>((acc, market) => {
              const temp = parseTempFromTitle(market.groupItemTitle);
              if (temp === null) return acc;

              let prices: string[];
              try {
                prices = JSON.parse(market.outcomePrices) as string[];
              } catch {
                return acc;
              }

              const yesRaw = Number.parseFloat(prices[0] ?? '0');
              const noRaw = Number.parseFloat(prices[1] ?? '0');
              if (Number.isNaN(yesRaw) || Number.isNaN(noRaw)) return acc;

              acc.push({
                temp,
                yesProb: Math.round(yesRaw * 1000) / 10, // 0–1 → 0–100, 1 decimal
                noProb: Math.round(noRaw * 1000) / 10,
              });
              return acc;
            }, [])
            .sort((a, b) => a.temp - b.temp);

          if (!rawMarkets.length) {
            yield* new PolymarketFetchError({
              cause: `Event "${event.title}" has no parseable temperature markets.`,
            });
          }

          // Assign market kind: first bucket is BELOW, last is ABOVE, rest are EXACT
          const lastIdx = rawMarkets.length - 1;
          const lines = rawMarkets.map((l, i) => {
            let kind: string;
            if (i === 0) {
              kind = 'BELOW';
            } else if (i === lastIdx) {
              kind = 'ABOVE';
            } else {
              kind = 'EXACT';
            }
            return { ...l, kind };
          });

          const content = lines
            .map((l) => `${l.temp} | ${l.kind} | YES ${l.yesProb} | NO ${l.noProb}`)
            .join('\n');

          // Ensure predicts/ directory exists
          yield* Effect.tryPromise({
            try: () => mkdir(PREDICTS_DIR, { recursive: true }),
            catch: (err) =>
              new PolymarketFetchError({
                cause: `Cannot create predicts/ dir: ${err instanceof Error ? err.message : String(err)}`,
              }),
          });

          const outPath = opts.output ?? join(PREDICTS_DIR, `${slug}.md`);

          yield* Effect.tryPromise({
            try: () => writeFile(outPath, content, 'utf8'),
            catch: (err) =>
              new PolymarketFetchError({
                cause: `Cannot write file: ${err instanceof Error ? err.message : String(err)}`,
              }),
          });

          process.stdout.write(`\nSaved ${lines.length} markets to ${outPath}\n`);
          process.stdout.write('\nMarkets saved:\n');
          for (const l of lines) {
            process.stdout.write(
              `  ${l.temp}°C  [${l.kind}]  YES ${l.yesProb}%  NO ${l.noProb}%\n`,
            );
          }
          process.stdout.write('\n');
        }),
      );
    });
}

import { Effect } from 'effect';
import { PolymarketFetchError } from '#types.js';
import { fetchPolymarketEvent } from '#fetchers/polymarket.js';
import { MONTH_NAMES_FULL, POLYMARKET_EVENT_URL } from '#utils/constants.js';

// Matches the leading numeric part of a groupItemTitle like "23°C" or "23.5°C"
const TEMP_RE = /^([\d.]+)/;

/**
 * Builds the canonical Polymarket "highest temperature" event URL for a city/date.
 *
 * Slug format: `highest-temperature-in-<city>-on-<month>-<day>-<year>` where the city is
 * lowercased (spaces → hyphens), the month is its full English name, and the day has no
 * leading zero.
 *
 * @param city - City name (e.g. `"Singapore"`); case and spaces are normalized.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @returns The full Polymarket event URL.
 * @example
 * buildPolymarketEventUrl('Singapore', '2026-06-07')
 * // → 'https://polymarket.com/event/highest-temperature-in-singapore-on-june-7-2026'
 */
export function buildPolymarketEventUrl(city: string, date: string): string {
  const [year, monthStr, dayStr] = date.split('-');
  const month = MONTH_NAMES_FULL[Number.parseInt(monthStr, 10) - 1];
  const day = Number.parseInt(dayStr, 10);
  const citySlug = city.trim().toLowerCase().replace(/\s+/g, '-');
  const slug = `highest-temperature-in-${citySlug}-on-${month}-${day}-${year}`;
  return `${POLYMARKET_EVENT_URL}/${slug}`;
}

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
 * Fetches a Polymarket event and extracts its temperature buckets as a sorted, de-duplicated
 * list of thresholds — entirely in memory, no file is written.
 *
 * The bucket temperatures become the probability thresholds (`P(max > X)`) the voting system
 * evaluates. Markets with non-numeric titles are ignored.
 *
 * @param url - Full Polymarket event URL (e.g. `https://polymarket.com/event/<slug>`).
 * @returns Ascending, de-duplicated bucket temperatures.
 * @throws PolymarketFetchError if the URL is invalid, the fetch fails, or no temperature
 * markets are found.
 */
export const fetchPolymarketThresholds = Effect.fn('fetchPolymarketThresholds')(function* (
  url: string,
) {
  // Extract slug from the last non-empty URL path segment
  const parsed = yield* Effect.try({
    try: () => new URL(url),
    catch: () => new PolymarketFetchError({ cause: `Invalid URL: "${url}"` }),
  });

  const rawSlug = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (!rawSlug) {
    return yield* new PolymarketFetchError({
      cause: `Cannot extract event slug from URL: "${url}"`,
    });
  }
  // Effect runtime guarantees rawSlug is defined past this point;
  // the assertion communicates this to TypeScript's type checker.
  const slug = rawSlug as string;

  process.stdout.write(`Fetching Polymarket event: ${slug}\n`);

  const event = yield* fetchPolymarketEvent(slug);
  process.stdout.write(`Found: ${event.title}\n`);

  const thresholds = [
    ...new Set(
      event.markets
        .map((market) => parseTempFromTitle(market.groupItemTitle))
        .filter((temp): temp is number => temp !== null),
    ),
  ].sort((a, b) => a - b);

  if (!thresholds.length) {
    return yield* new PolymarketFetchError({
      cause: `Event "${event.title}" has no parseable temperature markets.`,
    });
  }

  return thresholds;
});

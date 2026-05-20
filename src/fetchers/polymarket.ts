import { Effect } from 'effect';
import { PolymarketFetchError } from '#types.js';
import type { PolymarketEvent } from '#types.js';
import { POLYMARKET_GAMMA_URL } from '#utils/constants.js';

/**
 * Fetches a Polymarket event and its nested markets from the Gamma API.
 *
 * @param slug - The event slug extracted from the Polymarket URL (last path segment).
 * @returns The first matching `PolymarketEvent` with its `markets` array.
 * @throws PolymarketFetchError if the request fails, times out, or no event is found.
 */
export const fetchPolymarketEvent = Effect.fn('fetchPolymarketEvent')(function* (slug: string) {
  const url = `${POLYMARKET_GAMMA_URL}/events?slug=${encodeURIComponent(slug)}`;

  const res = yield* Effect.tryPromise({
    try: (signal) => fetch(url, { signal }),
    catch: (err) =>
      new PolymarketFetchError({
        cause: err instanceof Error ? err.message : String(err),
      }),
  }).pipe(
    Effect.timeout('10 seconds'),
    Effect.catchTag('TimeoutException', () =>
      Effect.fail(new PolymarketFetchError({ cause: 'Request timed out' })),
    ),
  );

  if (!res.ok) {
    return yield* new PolymarketFetchError({ cause: `Gamma API HTTP ${res.status}` });
  }

  const events = yield* Effect.tryPromise({
    try: () => res.json() as Promise<PolymarketEvent[]>,
    catch: (err) =>
      new PolymarketFetchError({
        cause: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
      }),
  });

  if (!events.length) {
    return yield* new PolymarketFetchError({
      cause: `No Polymarket event found for slug "${slug}". Check the URL is correct.`,
    });
  }

  return events[0] as PolymarketEvent;
});

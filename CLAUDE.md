# Polly Weather Forecast

## What This Project Does

CLI tool that fetches weather forecasts from 4 major NWP (Numerical Weather Prediction) models,
applies per-model bias correction, and runs an ensemble voting system to compute probability
distributions of the daily maximum temperature for a given city and date.

The goal is to identify mispricings in Polymarket weather prediction markets.

---

## Tech Stack

- **Runtime:** Node.js v24+ (native `fetch`, native TypeScript strip support)
- **Language:** TypeScript (ESM, `NodeNext` module resolution)
- **Package manager:** pnpm
- **Build:** `tsc` → compiles `src/` to `dist/`
- **Effect:** `effect` library for typed errors, async I/O, and concurrency
- **Linter:** ESLint with `airbnb-base` + `@typescript-eslint`
- **Formatter:** Prettier
- **Tests:** None — no test framework is configured

---

## Project Structure

```
src/
├── index.ts                  # CLI entry point — registers commands and calls cli.parse()
├── types.ts                  # All shared interfaces, types, and typed error classes
├── commands/
│   ├── forecast.ts           # reusable runCityForecast Effect (resolve → poly buckets → models → vote → snapshot)
│   ├── forecastAll.ts        # forecast-all — runs runCityForecast for several cities on one date
│   ├── bias.ts               # bias set/list command actions
│   └── polymarket.ts         # buildPolymarketEventUrl (city+date → URL) + fetchPolymarketThresholds (URL → buckets)
├── bias/
│   ├── bias.json             # Persisted bias corrections (read/written at runtime)
│   ├── store.ts              # Async read/write of bias.json (Effect)
│   └── apply.ts              # Applies bias correction to a raw forecast (pure)
├── fetchers/
│   ├── openMeteo.ts          # Fetches from all models via Open-Meteo API (Effect)
│   └── polymarket.ts         # Fetches event + markets from Polymarket Gamma API (Effect)
├── utils/
│   ├── constants.ts          # All project-wide constants (URLs, timeouts, models, paths, batch cities, month names)
│   ├── display.ts            # Terminal output — model table, ensemble summary, probability bars
│   ├── geocoding.ts          # City name → lat/lon via Open-Meteo geocoding API (Effect)
│   ├── runOrExit.ts          # Runs an Effect and exits process on failure
│   ├── snapshotWriter.ts     # Appends forecast snapshots (incl. Polymarket URL) to forecasts/snapshots/<month>-<day>.md (Effect)
│   ├── stats.ts              # Pure math: mean, stddev, percentile, normalCDF
│   └── validateDate.ts       # CLI date validation with warnings
└── voting/
    └── voting-system.ts      # Ensemble voting: aggregates models into probability output (Effect)

forecasts/                    # Daily forecast outputs (both written by B1)
├── log.jsonl                 # Structured machine-readable forecast+outcome log (B1→B2→B3 loop)
└── snapshots/                # Human-readable <month>-<day>.md snapshots — one file per date
dist/                         # Compiled JS output — gitignored, never edit directly
```

---

## Data Sources

### Open-Meteo (weather forecasts) — free, no API key

| Purpose | Endpoint |
|---------|----------|
| Geocoding | `https://geocoding-api.open-meteo.com/v1/search` |
| Forecasts | `https://api.open-meteo.com/v1/forecast` |

#### Weather Models

| Model ID | Open-Meteo param | Provider | Resolution |
|----------|-----------------|----------|------------|
| `ifs`    | `ecmwf_ifs025`  | ECMWF    | 25 km, 15-day |
| `gfs`    | `gfs_seamless`  | NOAA     | 50 km, 16-day |
| `icon`   | `icon_seamless` | DWD      | 2–11 km, 7–15 day |
| `gem`    | `gem_global`    | ECCC     | ~25 km, 16-day |

### Polymarket Gamma API (market odds) — free, no auth

| Purpose | Endpoint |
|---------|----------|
| Event + markets | `https://gamma-api.polymarket.com/events?slug=<slug>` |

- The `<slug>` is the last path segment of any Polymarket event URL
  (e.g. `highest-temperature-in-london-on-may-21-2026`).
- Response is an array of events; each event has a nested `markets` array — one entry per
  temperature bucket.
- Each market exposes `groupItemTitle` (e.g. `"22°C"` or `"18°C or below"`). Only its leading
  numeric value is read — it becomes a bucket temperature / probability threshold. (Markets also
  carry `outcomePrices`, but the model no longer reads the live odds.)

---

## CLI Commands

```bash
# Run ensemble forecast + Polymarket comparison for several cities on one date.
# For each city the Polymarket event URL is built automatically from city + date; its temperature
# buckets are fetched (in memory) and used as the probability thresholds, and the URL is recorded
# in the snapshot.
# Defaults to the 5 built-in cities (BATCH_CITIES: London, Paris, Beijing, Shenzhen, Singapore).
node dist/index.js forecast-all --date "2026-06-07"
# Override the city list (runs ONLY these, replacing the default):
node dist/index.js forecast-all --date "2026-06-07" --cities "London,Paris"

# Manage bias corrections
node dist/index.js bias set --city "London" --model ifs --value -1.5
node dist/index.js bias list
```

### Development Scripts

```bash
pnpm run build        # tsc — compile src/ to dist/
pnpm run lint         # ESLint check
pnpm run lint:fix     # ESLint auto-fix
pnpm run fmt          # Prettier format src/
pnpm run fmt:check    # Prettier check (useful in CI)
```

> Always run `pnpm run build` after editing TypeScript. The CLI runs from `dist/`, not `src/`.

> A husky `pre-commit` hook (`.husky/pre-commit`) runs `pnpm fmt`, stages the result (`git add -A`),
> then `pnpm lint` — so every commit is auto-formatted and lint-checked before it lands.

---

## Key Architecture Decisions

### Forecast Core
- `runCityForecast` in `src/commands/forecast.ts` is the reusable Effect that runs a full
  forecast for **one** city/date (resolve city → fetch Polymarket buckets → fetch models → bias →
  vote → print → snapshot). The `forecast-all` command calls it once per city — keep all forecast
  logic here. There is no single-city `forecast` command; `forecast-all` is the only entry point.
- `forecast-all` in `src/commands/forecastAll.ts` iterates cities **sequentially** (`for…of` +
  `yield*`), not in parallel: parallel runs would interleave stdout and race on the read-modify-write
  of the shared daily snapshot file. Each city is wrapped in `Effect.either` so one failure
  (e.g. no Polymarket event) is reported in the summary without aborting the rest.
- The Polymarket event URL for each city is built **inside** `runCityForecast` by
  `buildPolymarketEventUrl(resolvedName, date)` in `src/commands/polymarket.ts` (slug:
  `highest-temperature-in-<city>-on-<full-month>-<day>-<year>`, using `MONTH_NAMES_FULL`).
  `fetchPolymarketThresholds(url)` then fetches the event and returns its bucket temperatures
  **in memory** — nothing is written to disk. A missing event fails the city (caught by the
  `Effect.either` above).

### Bias Correction
- Bias is stored per city (resolved name) and per model in `src/bias/bias.json`
- Formula: `corrected = raw - bias`
- A positive bias means the model runs warm → correction shifts temperature down
- The bias store is loaded **once** per CLI invocation (not once per model) to avoid redundant disk reads

### Voting System
- All ensemble stats (percentiles, spread, probabilities) are computed on **daily max temperature**
- `runVotingSystem()` in `src/voting/voting-system.ts` takes corrected forecasts and optional thresholds
- Probabilities use `normalCDF`: `P(max > X) = 1 − normalCDF(X, ensembleMean, ensembleSpread)`

### HTTP Reliability
- All `fetch` calls use Effect's built-in `AbortSignal` (via `Effect.tryPromise`) and `Effect.timeout('10 seconds')`
- `fetchAllModels` uses `Effect.forEach` with `Effect.either` — one failing model never blocks the others
- If a model returns HTTP 200 but all-null data, `fetchModel` fails with a descriptive `FetchError` so the warning is always visible

### Polymarket Analysis

Polymarket weather events are split into discrete temperature buckets (one `market` per bucket).
The model uses Polymarket **only to discover which temperatures to evaluate**: it builds the
event URL from city + date, fetches the event, and parses the leading number of each
`groupItemTitle` into a bucket temperature. Those temperatures become the voting system's
probability thresholds (`P(max > X)`), and the event URL is recorded in the snapshot.

This happens entirely in memory (`fetchPolymarketThresholds` in `src/commands/polymarket.ts`) —
no odds files are written or read, and the live YES/NO prices are not consumed. The model does
not compute per-bucket edge/signal recommendations.

---

## Coding Rules

### Language
- **All code, comments, JSDoc, and variable names must be in English — no exceptions.**
- User-facing CLI output strings may be in the language of the target audience, but code internals are always English.

### TypeScript
- `strict: true` — no implicit `any`, no implicit returns
- Never use `as any` — use proper types or type guards
- Prefer type guards over `as` casts where possible
- All exported functions must have explicit return types
- All shared types live in `src/types.ts` — do not define inline object types that are reused across files
  (e.g. `ForecastRunOptions`, used by the `forecast-all` command)
- Internal modules are imported via the `#` **subpath aliases** declared in `package.json` → `imports`,
  not relative paths: `#types.js`, `#utils/*.js`, `#fetchers/*.js`, `#bias/*.js`, `#voting/*.js`,
  `#commands/*.js`. Example: `import { runCityForecast } from '#commands/forecast.js'`
- All imports must keep the `.js` extension (ESM + NodeNext) — omitting it compiles fine but fails at runtime

### Comments & JSDoc
- **All functions must have JSDoc — no exceptions**, regardless of visibility or location
- Exported functions: `@param`, `@returns`, `@throws` (when applicable), `@example` (when it aids understanding)
- Private/internal helpers: at minimum a single-line description line
- Inline comments explain **why**, not **what** — the code itself explains what
- No commented-out code — delete it

### Async & I/O
- Never use synchronous I/O (`readFileSync`, `writeFileSync`) — always use `fs/promises` wrapped in `Effect.tryPromise`
- Never use `Math.max(...largeArray)` spread — use `.reduce()` to avoid stack overflow
- Parallel independent async operations must use `Effect.all` with `{ concurrency: N }` or `Effect.forEach` with `{ concurrency: 'unbounded' }`
- Never use raw `Promise`, `async/await`, or `try/catch` for I/O — wrap everything in Effect

### Constants
- All magic strings and numbers go in `src/utils/constants.ts`
- No hardcoded URLs, timeouts, or file paths anywhere else in the codebase

### Error Handling
- All errors are typed — defined as `Data.TaggedError` classes in `src/types.ts`
- Never `throw` inside Effect code — use `return yield* new MyError({ cause: '...' })`
- Always narrow unknown errors: `err instanceof Error ? err.message : String(err)`
- The CLI runner (`src/utils/runOrExit.ts`) uses `Effect.runPromiseExit` + `Cause.squash` to extract the typed error message and exit with code 1

### Code Style (enforced by ESLint + Prettier)
- Single quotes for strings
- Trailing commas
- `printWidth: 100`
- No nested ternaries (`no-nested-ternary`)
- No parameter reassignment (`no-param-reassign`) — use a local variable instead
- No `__` prefixed variables (`no-underscore-dangle`) — use descriptive names

---

## Effect-TS Patterns

The entire I/O layer uses [Effect](https://effect.website). **All new functions that do I/O, HTTP, or file operations must follow these patterns.**

### Typed errors

All error types live in `src/types.ts` and extend `Data.TaggedError`:

```typescript
export class GeocodingError extends Data.TaggedError('GeocodingError')<{ cause: string }> {
  get message(): string { return this.cause; }
}
```

Add a `get message()` getter so the error prints correctly when it escapes to the CLI runner.

### Async functions (HTTP / file I/O)

Use `Effect.fn` for named functions — it enables automatic tracing and better stack traces:

```typescript
export const myFn = Effect.fn('myFn')(function* (arg: string) {
  const res = yield* Effect.tryPromise({
    try: (signal) => fetch(url, { signal }),   // signal = AbortSignal, injected automatically
    catch: (err) => new MyError({ cause: String(err) }),
  }).pipe(
    Effect.timeout('10 seconds'),
    Effect.catchTag('TimeoutException', () =>
      Effect.fail(new MyError({ cause: 'Request timed out' })),
    ),
  );

  if (!res.ok) {
    return yield* new MyError({ cause: `HTTP ${res.status}` });
  }

  const data = yield* Effect.tryPromise({
    try: () => res.json() as Promise<MyResponse>,
    catch: (err) => new MyError({ cause: String(err) }),
  });

  return data;
});
```

### Failing explicitly

Use `return yield*` to terminate the generator with a typed failure:

```typescript
if (condition) {
  return yield* new MyError({ cause: 'reason' });
}
```

Never use `throw` inside an `Effect.gen` generator.

### Wrapping pure throwing code

When calling legacy code that may `throw`, use `Effect.try`:

```typescript
export const safeCompute = (input: number[]): Effect.Effect<Result, ComputeError> =>
  Effect.try({
    try: () => pureFunctionThatThrows(input),
    catch: (err) => new ComputeError({ cause: err instanceof Error ? err.message : String(err) }),
  });
```

### Running in parallel

```typescript
// Two effects in parallel, both must succeed:
const [a, b] = yield* Effect.all([effectA, effectB], { concurrency: 2 });

// N effects in parallel, collect all results regardless of failure:
const results = yield* Effect.forEach(items, (item) => Effect.either(myEffect(item)), {
  concurrency: 'unbounded',
});
// results is Either<Error, Value>[] — check r._tag === 'Right' / 'Left'
```

### CLI entry point

Command actions must never be `async`. Use `runOrExit` from `src/utils/runOrExit.ts`:

```typescript
.action((opts) => {
  runOrExit(
    Effect.gen(function* () {
      const result = yield* myEffect(opts.value);
      console.log(result);
    }),
  );
});
```

`runOrExit` handles `Effect.runPromiseExit`, extracts the error message via `Cause.squash`, and exits with code 1 on failure.

---

## Adding a New Weather Model

1. Add the model definition to `MODELS` in `src/utils/constants.ts`
2. Add the new `ModelId` value to the union type in `src/types.ts`
3. No other changes needed — `fetchAllModels` and `runVotingSystem` are model-agnostic

---

## Known Limitations

- **AIFS** is currently disabled (commented out in `MODELS` in `src/utils/constants.ts`) due to chronic null-data responses from Open-Meteo upstream. Re-enable by uncommenting and adding `'aifs'` back to the `ModelId` union in `src/types.ts`.
- Models cover at most **15 days** ahead. The CLI warns if the requested date is out of range.
- Bias corrections must be set manually via `bias set`. There is no automated historical
  back-testing yet.
- `src/bias/bias.json` uses the **resolved city name** (e.g. `"London"`, not `"london"`) as the key.
  The city name comes from the Open-Meteo geocoding API response.
- Polymarket buckets are read live on every run (no caching). A city whose Polymarket event does
  not exist for the given date fails that city in the `forecast-all` summary.

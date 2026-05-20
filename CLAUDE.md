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

---

## Project Structure

```
src/
├── index.ts                  # CLI entry point — registers commands and calls cli.parse()
├── types.ts                  # All shared interfaces, types, and typed error classes
├── commands/
│   ├── forecast.ts           # forecast command action (now supports --polymarket)
│   ├── bias.ts               # bias set/list command actions
│   └── polymarket.ts         # polymarket fetch — scrapes Gamma API into predicts/<slug>.md
├── bias/
│   ├── store.ts              # Async read/write of data/bias.json (Effect)
│   └── apply.ts              # Applies bias correction to a raw forecast (pure)
├── fetchers/
│   ├── openMeteo.ts          # Fetches from all models via Open-Meteo API (Effect)
│   └── polymarket.ts         # Fetches event + markets from Polymarket Gamma API (Effect)
├── utils/
│   ├── constants.ts          # All project-wide constants (URLs, timeouts, models, paths)
│   ├── display.ts            # Terminal output — tables, formatted results, Polymarket analysis
│   ├── geocoding.ts          # City name → lat/lon via Open-Meteo geocoding API (Effect)
│   ├── parsePolymarket.ts    # Parses predicts/*.md odds files (Effect)
│   ├── runOrExit.ts          # Runs an Effect and exits process on failure
│   ├── stats.ts              # Pure math: mean, stddev, percentile, normalCDF
│   └── validateDate.ts       # CLI date validation with warnings
└── voting/
    └── voting-system.ts      # Ensemble voting: aggregates models into probability output (Effect)

data/
└── bias.json                 # Persisted bias corrections — DO NOT commit with real values
predicts/                     # Scraped Polymarket odds — one .md file per event (see format below)
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
- Each market exposes `groupItemTitle` (e.g. `"22°C"` or `"18°C or below"`) and
  `outcomePrices`, which is a **JSON-encoded string** like `"[\"0.43\", \"0.57\"]"`
  containing `[yesPrice, noPrice]` in `0–1` format. Always `JSON.parse` before using.

---

## CLI Commands

```bash
# Run ensemble forecast
node dist/index.js forecast --city "London" --date "2026-05-20"
node dist/index.js forecast --city "London" --date "2026-05-20" --threshold "18,20,22"

# Manage bias corrections
node dist/index.js bias set --city "London" --model ifs --value -1.5
node dist/index.js bias list

# Scrape Polymarket odds for an event → predicts/<slug>.md
node dist/index.js polymarket fetch \
  --url "https://polymarket.com/event/highest-temperature-in-london-on-may-21-2026"
# Optional custom output path:
node dist/index.js polymarket fetch --url "..." --output predicts/London-21-may.md

# Compare model probabilities against the scraped Polymarket odds.
# Thresholds are extracted automatically from the .md file (merged with any --threshold).
node dist/index.js forecast --city "London" --date "2026-05-21" \
  --polymarket predicts/highest-temperature-in-london-on-may-21-2026.md
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

---

## Key Architecture Decisions

### Bias Correction
- Bias is stored per city (resolved name) and per model in `data/bias.json`
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

Polymarket weather events are split into discrete temperature buckets. Each market belongs to
one of **three kinds** — assigned automatically when scraping (`src/commands/polymarket.ts`):

| Kind    | `groupItemTitle` example | Wins YES when |
|---------|--------------------------|---------------|
| `below` | `"18°C or below"` (first bucket) | `max ≤ 18` |
| `exact` | `"22°C"` (middle bucket)         | `max` falls in the `[X, X+1)` bucket |
| `above` | `"28°C"` (last bucket)           | `max ≥ 28` |

#### Model probability per kind
`buildRecommendations()` in `src/utils/display.ts` computes the model's estimate as:

| Kind    | Formula |
|---------|---------|
| `below` | `100 − probAbove(X)` |
| `exact` | `probAbove(X−1) − probAbove(X)` *(needs consecutive integer thresholds)* |
| `above` | `probAbove(X)` |

#### Edge & signal logic
- `edge = modelProb% − marketYesProb%`
- `edge ≥ MIN_BET_EDGE_PERCENT` → **BET YES**
- `edge ≤ −MIN_BET_EDGE_PERCENT` → **BET NO**
- Otherwise → **SKIP**
- "Best opportunity" = highest absolute edge among non-SKIP recommendations

#### File format (`predicts/<slug>.md`)
```
18 | BELOW | YES 0.2 | NO 99.9
22 | EXACT | YES 25.5 | NO 74.5
28 | ABOVE | YES 0.1 | NO 100
```
The legacy format `22 | YES 27 | NO 74` (no kind marker) is still parsed for backward
compatibility — those lines default to `kind='above'`.

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

- **AIFS** frequently returns `null` values on Open-Meteo — this is an upstream data availability
  issue, not a bug. The voting system gracefully skips models with no data.
- Models cover at most **15 days** ahead. The CLI warns if the requested date is out of range.
- Bias corrections must be set manually via `bias set`. There is no automated historical
  back-testing yet.
- `data/bias.json` uses the **resolved city name** (e.g. `"London"`, not `"london"`) as the key.
  The city name comes from the Open-Meteo geocoding API response.
- Polymarket `exact` analysis assumes **consecutive integer thresholds**. If the scraped
  thresholds are sparse (e.g. `22, 25, 28`), the EXACT formula falls back to `N/A` because
  `probAbove(X−1)` isn't available.
- `outcomePrices` from the Gamma API is a **JSON-encoded string**, not an array — both
  `parsePolymarket` (file → struct) and the fetch command (API → file) rely on this.

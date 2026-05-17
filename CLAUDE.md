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
- **Linter:** ESLint with `airbnb-base` + `@typescript-eslint`
- **Formatter:** Prettier

---

## Project Structure

```
src/
├── index.ts                  # CLI entry point (commander) — forecast + bias commands
├── types.ts                  # All shared interfaces and types
├── bias/
│   ├── store.ts              # Async read/write of data/bias.json
│   └── apply.ts              # Applies bias correction to a raw forecast
├── fetchers/
│   └── openMeteo.ts          # Fetches from all 4 models via Open-Meteo API
├── utils/
│   ├── constants.ts          # All project-wide constants (URLs, timeouts, models, paths)
│   ├── geocoding.ts          # City name → lat/lon via Open-Meteo geocoding API
│   └── stats.ts              # Pure math: mean, stddev, percentile, normalCDF
└── voting/
    └── voting-system.ts      # Ensemble voting: aggregates models into probability output

data/
└── bias.json                 # Persisted bias corrections — DO NOT commit with real values
dist/                         # Compiled JS output — gitignored, never edit directly
```

---

## Data Sources

All data comes from **Open-Meteo** (free, no API key required):

| Purpose | Endpoint |
|---------|----------|
| Geocoding | `https://geocoding-api.open-meteo.com/v1/search` |
| Forecasts | `https://api.open-meteo.com/v1/forecast` |

### Weather Models

| Model ID | Open-Meteo param | Provider | Resolution |
|----------|-----------------|----------|------------|
| `ifs`    | `ecmwf_ifs025`  | ECMWF    | 25 km, 15-day |
| `aifs`   | `ecmwf_aifs025` | ECMWF AI | 25 km, 15-day |
| `gfs`    | `gfs_seamless`  | NOAA     | 50 km, 16-day |
| `icon`   | `icon_seamless` | DWD      | 2–11 km, 7–15 day |

---

## CLI Commands

```bash
# Run ensemble forecast
node dist/index.js forecast --city "London" --date "2026-05-20"
node dist/index.js forecast --city "London" --date "2026-05-20" --threshold "18,20,22"

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
- All `fetch` calls use `AbortController` with a 10-second timeout (`FETCH_TIMEOUT_MS`)
- `fetchAllModels` uses `Promise.allSettled` — one failing model never blocks the others

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
- Public exported functions in `utils/` must have JSDoc (`@param`, `@returns`, `@throws`, `@example`)
- Inline comments explain **why**, not **what** — the code itself explains what
- No commented-out code — delete it

### Async & I/O
- Never use synchronous I/O (`readFileSync`, `writeFileSync`) — always use `fs/promises`
- Never use `Math.max(...largeArray)` spread — use `.reduce()` to avoid stack overflow
- Parallel independent async operations must use `Promise.all` or `Promise.allSettled`

### Constants
- All magic strings and numbers go in `src/utils/constants.ts`
- No hardcoded URLs, timeouts, or file paths anywhere else in the codebase

### Error Handling
- Always narrow error types: `err instanceof Error ? err.message : String(err)`
- Throw descriptive errors with context (which model failed, which city, etc.)
- CLI catches all errors at the top level in `index.ts` and exits with code 1

### Code Style (enforced by ESLint + Prettier)
- Single quotes for strings
- Trailing commas
- `printWidth: 100`
- No nested ternaries (`no-nested-ternary`)
- No parameter reassignment (`no-param-reassign`) — use a local variable instead
- No `__` prefixed variables (`no-underscore-dangle`) — use descriptive names

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

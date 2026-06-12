> ⚠️ **Heads up:** got tired of betting in weather, so I'm open-sourcing this model for anyone who wants to improve it.

# Poly Weather Forecast - CLI tool

CLI tool that fetches weather forecasts from 4 major NWP (Numerical Weather Prediction) models,
applies per-model bias correction, and runs an ensemble voting system to compute probability
distributions of the daily maximum temperature for a given city and date.

## Cities with BIAS:

- London
- Paris
- Beijing
- Shenzhen
- Singapore

## How to use:

### 1. Build

pnpm build

### 2. Run Model w/ bet opportunity

node dist/index.js forecast-all --date "2026-06-07"

### 2.1. Run Model w/ bet opportunity for only a list of cities

node dist/index.js forecast-all --date "2026-06-07" --cities "London,Paris"

For each city, the Polymarket event URL is built automatically from the city + date. The event's
temperature buckets are fetched (in memory) and used as the probability thresholds shown as
`P(max > X)`, and the event URL is recorded in the daily snapshot.

## Tech Stack

### Runtime & Language

- **[Node.js](https://nodejs.org) v24+** — native `fetch` and native TypeScript support (no transpile step to run)
- **[TypeScript](https://www.typescriptlang.org)** — `strict` mode, ESM with `NodeNext` module resolution
- **[Effect-TS](https://effect.website)** — the whole I/O layer (HTTP, file access, concurrency) is built on Effect:
  typed errors, automatic `AbortSignal` + timeouts, and parallel model fetches that isolate failures

### CLI & Output

- **[Commander](https://github.com/tj/commander.js)** — command parsing (`forecast-all`, `bias`)
- **[cli-table3](https://github.com/cli-table/cli-table3)** — formatted terminal tables for the forecast output

### Tooling

- **[pnpm](https://pnpm.io)** — package manager
- **[ESLint](https://eslint.org)** (`airbnb-base` + `@typescript-eslint`) + **[Prettier](https://prettier.io)** — linting and formatting
- **[husky](https://typicode.github.io/husky)** — `pre-commit` hook that auto-formats and lint-checks every commit

### External APIs (free, no API key)

- **[Open-Meteo](https://open-meteo.com)** — geocoding (city → lat/lon) and weather forecasts from 4 NWP models:
  ECMWF IFS, NOAA GFS, DWD ICON, and ECCC GEM
- **[Polymarket Gamma API](https://gamma-api.polymarket.com)** — live market odds per temperature bucket;
  the buckets are extracted and used as the probability thresholds (`P(max > X)`) the model evaluates,
  and the event URL is recorded in the daily snapshot

# Polly Weather Forecast

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

## Other commands:

### Run Model w/ bet opportunity for a single city

node dist/index.js forecast --city "Singapore" --date "2026-06-07" --polymarket "https://polymarket.com/pt/event/highest-temperature-in-singapore-on-june-7-2026"

### Run Model without bet opportunity for a single city

node dist/index.js forecast --city "Singapore" --date "2026-06-07"

## Tech Stack

### Runtime & Language

- **[Node.js](https://nodejs.org) v24+** — native `fetch` and native TypeScript support (no transpile step to run)
- **[TypeScript](https://www.typescriptlang.org)** — `strict` mode, ESM with `NodeNext` module resolution
- **[Effect-TS](https://effect.website)** — the whole I/O layer (HTTP, file access, concurrency) is built on Effect:
  typed errors, automatic `AbortSignal` + timeouts, and parallel model fetches that isolate failures

### CLI & Output

- **[Commander](https://github.com/tj/commander.js)** — command parsing (`forecast`, `forecast-all`, `bias`, `polymarket`)
- **[cli-table3](https://github.com/cli-table/cli-table3)** — formatted terminal tables for the forecast and Polymarket analysis

### Tooling

- **[pnpm](https://pnpm.io)** — package manager
- **[ESLint](https://eslint.org)** (`airbnb-base` + `@typescript-eslint`) + **[Prettier](https://prettier.io)** — linting and formatting
- **[husky](https://typicode.github.io/husky)** — `pre-commit` hook that auto-formats and lint-checks every commit

### External APIs (free, no API key)

- **[Open-Meteo](https://open-meteo.com)** — geocoding (city → lat/lon) and weather forecasts from 4 NWP models:
  ECMWF IFS, NOAA GFS, DWD ICON, and ECCC GEM
- **[Polymarket Gamma API](https://gamma-api.polymarket.com)** — live market odds per temperature bucket,
  used to compute the edge between the model's probabilities and the market price

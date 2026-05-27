# Polly Weather Forecast

CLI tool that fetches weather forecasts from 4 major NWP (Numerical Weather Prediction) models,
applies per-model bias correction, and runs an ensemble voting system to compute probability
distributions of the daily maximum temperature for a given city and date.

## How to use:

### 1. Build

pnpm build

### 2. Fetch and save polymarket odds

node dist/index.js polymarket fetch --url "https://polymarket.com/pt/event/highest-temperature-in-madrid-on-may-22-2026"

### 3. Run Model w/ bet opportunity

node dist/index.js forecast --city "Madrid" --date "2026-05-22" --polymarket predicts/highest-temperature-in-madrid-on-may-22-2026.md

-- OR --

node dist/index.js forecast --city "Singapore" --date "2026-05-28" --polymarket "https://polymarket.com/pt/event/highest-temperature-in-singapore-on-may-28-2026"

### 4. Run Model withour bet opportunity (skip step 2. and 3.)

node dist/index.js forecast --city "London" --date "2026-05-21"
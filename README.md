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

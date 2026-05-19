# Polly Weather Forecast

CLI tool that fetches weather forecasts from 4 major NWP (Numerical Weather Prediction) models,
applies per-model bias correction, and runs an ensemble voting system to compute probability
distributions of the daily maximum temperature for a given city and date.

### To run:

pnpm build

node dist/index.js forecast --city "Shanghai" --date "2026-05-20"
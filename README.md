# Polly Weather Forecast

CLI tool that fetches weather forecasts from 4 major NWP (Numerical Weather Prediction) models,
applies per-model bias correction, and runs an ensemble voting system to compute probability
distributions of the daily maximum temperature for a given city and date.

### Buid

pnpm build


### Run Model:

node dist/index.js forecast --city "London" --date "2026-05-21"

### Run Model w/ bet opportunity

node dist/index.js forecast --city "London" --date "2026-05-21" --polymarket predicts/London-21-may.md
import { DATE_RE, MAX_FORECAST_DAYS } from '#utils/constants.js';

export function validateDate(date: string): void {
  if (!DATE_RE.test(date)) {
    console.error(`Error: --date must be in YYYY-MM-DD format (got "${date}")`);
    process.exit(1);
  }

  const daysDiff = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);

  if (daysDiff < -1) {
    console.warn(
      '⚠️  Data no passado — os modelos não têm dados históricos, podem devolver nulos.',
    );
  }

  if (daysDiff > MAX_FORECAST_DAYS) {
    console.warn(
      `⚠️  Data além de ${MAX_FORECAST_DAYS} dias — modelos podem não ter dados para essa data.`,
    );
  }
}

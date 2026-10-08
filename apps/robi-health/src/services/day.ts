import type { SQL } from 'bun';
export interface LocalDay {
  date: string;
  start: string;
  end: string;
}
export async function localDay(db: SQL, timezone: string, now: Date): Promise<LocalDay> {
  const rows = await db<{ date: string; start: Date; end: Date }[]>`WITH day AS (
    SELECT (${now.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date AS date
  ) SELECT date::text, date::timestamp AT TIME ZONE ${timezone} AS start,
    (date+1)::timestamp AT TIME ZONE ${timezone} AS end FROM day`;
  return { date: rows[0].date, start: rows[0].start.toISOString(), end: rows[0].end.toISOString() };
}

/**
 * Birthday maths (pure, so it's easy to test). Dates are the phone's local
 * calendar days; times don't matter.
 */

export type BirthdayRow = { person_id: string; tree_id: string; month: number; day: number; year: number | null };

export type Upcoming = BirthdayRow & {
  /** The next birthday, at midnight local time. */
  date: Date;
  /** 0 = today, 1 = tomorrow, ... */
  daysAway: number;
  /** Age they turn, if the birth year is known. */
  turning: number | null;
};

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The birthday in a given year (29 February → 28 February in other years). */
export function birthdayIn(year: number, month: number, day: number): Date {
  if (month === 2 && day === 29 && !isLeap(year)) return new Date(year, 1, 28);
  return new Date(year, month - 1, day);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function nextBirthday(row: BirthdayRow, today: Date): Upcoming {
  const t = startOfDay(today);
  let date = birthdayIn(t.getFullYear(), row.month, row.day);
  if (date < t) date = birthdayIn(t.getFullYear() + 1, row.month, row.day);
  const daysAway = Math.round((date.getTime() - t.getTime()) / 86_400_000);
  const turning = row.year ? date.getFullYear() - row.year : null;
  return { ...row, date, daysAway, turning: turning !== null && turning >= 0 ? turning : null };
}

/** Birthdays within the next `days` days (today included), soonest first. */
export function upcomingBirthdays(rows: BirthdayRow[], today: Date, days = 30): Upcoming[] {
  return rows
    .map((r) => nextBirthday(r, today))
    .filter((b) => b.daysAway < days)
    .sort((a, b) => a.daysAway - b.daysAway || a.month - b.month || a.day - b.day);
}

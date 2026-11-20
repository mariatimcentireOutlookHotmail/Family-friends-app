/**
 * Partial, possibly uncertain dates for births and deaths ("1952",
 * "about 1930", "March 1952", "14 March" with no year, ...), and how to check,
 * format and use them. Formatting uses Intl for the current UI language.
 */

export type Qualifier = "exact" | "about" | "before" | "after";

export type PartialDate = {
  year: number | null;
  month: number | null; // 1–12
  day: number | null;
  qualifier: Qualifier;
};

/** A life event as loaded from the database (day/month only if allowed). */
export type LifeEvent = {
  type: "birth" | "death";
  year: number | null;
  qualifier: Qualifier;
  /** True if a day/month exists, even when the viewer may not see it. */
  has_full_date: boolean;
  event_dates: { month: number; day: number | null } | { month: number; day: number | null }[] | null;
};

export type DateErrorKey = "needsYearOrDayMonth" | "dayNeedsMonth" | "invalidDate" | "inFuture" | "deathBeforeBirth";

/** The visible parts of an event as a PartialDate. */
export function eventToDate(event: LifeEvent): PartialDate {
  const parts = Array.isArray(event.event_dates) ? event.event_dates[0] : event.event_dates;
  return {
    year: event.year,
    month: parts?.month ?? null,
    day: parts?.day ?? null,
    qualifier: event.qualifier,
  };
}

/** True when the event has a day/month the current viewer can't see. */
export function hasHiddenParts(event: LifeEvent): boolean {
  const parts = Array.isArray(event.event_dates) ? event.event_dates[0] : event.event_dates;
  return event.has_full_date && !parts;
}

export function isEmptyDate(d: PartialDate): boolean {
  return d.year === null && d.month === null && d.day === null;
}

function daysInMonth(month: number, year: number | null): number {
  // Unknown year: allow 29 February (it may have been a leap year).
  return new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate();
}

/** Why a date can't be saved, or null if it's fine. Empty dates are fine. */
export function validateDate(d: PartialDate, today: Date = new Date()): DateErrorKey | null {
  if (isEmptyDate(d)) return null;
  if (d.day !== null && d.month === null) return "dayNeedsMonth";
  if (d.year === null && (d.month === null || d.day === null)) return "needsYearOrDayMonth";
  if (d.year !== null && (d.year < 1 || d.year > 2200)) return "invalidDate";
  if (d.month !== null && (d.month < 1 || d.month > 12)) return "invalidDate";
  if (d.day !== null && d.month !== null && (d.day < 1 || d.day > daysInMonth(d.month, d.year))) {
    return "invalidDate";
  }
  // Only an exact or "before"/"about" year in the future is impossible to know.
  if (d.year !== null && d.qualifier !== "after") {
    const latest = new Date(Date.UTC(d.year, (d.month ?? 1) - 1, d.day ?? 1));
    if (latest.getTime() > today.getTime()) return "inFuture";
  }
  return null;
}

/** Checks a birth and death together (death not before birth, by year). */
export function validateLifeDates(birth: PartialDate, death: PartialDate | null): DateErrorKey | null {
  if (death && birth.year !== null && death.year !== null && death.year < birth.year) {
    return "deathBeforeBirth";
  }
  return null;
}

/**
 * The date in the given language, without its qualifier:
 * "14 March 1952", "March 1952", "14 March", "1952" (or "1952年 3月 14日" etc.).
 */
export function formatDate(d: PartialDate, locale: string): string {
  const date = new Date(Date.UTC(d.year ?? 2000, (d.month ?? 1) - 1, d.day ?? 1));
  let options: Intl.DateTimeFormatOptions;
  if (d.year !== null && d.month !== null && d.day !== null) options = { dateStyle: "long" };
  else if (d.year !== null && d.month !== null) options = { year: "numeric", month: "long" };
  else if (d.month !== null && d.day !== null) options = { month: "long", day: "numeric" };
  else options = { year: "numeric" };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
}

/**
 * Age today from a birth date. `approximate` is true when the year is known
 * but not whether this year's birthday has passed, or the date is uncertain.
 */
export function ageFrom(birth: PartialDate, today: Date = new Date()): { age: number; approximate: boolean } | null {
  if (birth.year === null || birth.qualifier === "before" || birth.qualifier === "after") return null;
  let age = today.getUTCFullYear() - birth.year;
  if (birth.month === null || birth.day === null) {
    return age >= 0 ? { age, approximate: true } : null;
  }
  const hadBirthday =
    today.getUTCMonth() + 1 > birth.month ||
    (today.getUTCMonth() + 1 === birth.month && today.getUTCDate() >= birth.day);
  if (!hadBirthday) age -= 1;
  return age >= 0 ? { age, approximate: birth.qualifier === "about" } : null;
}

/** What to send to the database: null when empty. */
export function toPayload(d: PartialDate): PartialDate | null {
  return isEmptyDate(d) ? null : d;
}

/** Form text fields ↔ PartialDate. */
export type DateDraft = { year: string; month: string; day: string; qualifier: Qualifier };

export const emptyDateDraft: DateDraft = { year: "", month: "", day: "", qualifier: "exact" };

export function draftToDate(draft: DateDraft): PartialDate {
  const num = (s: string) => {
    const n = Number.parseInt(s.trim(), 10);
    return Number.isFinite(n) ? n : null;
  };
  return { year: num(draft.year), month: num(draft.month), day: num(draft.day), qualifier: draft.qualifier };
}

export function dateToDraft(d: PartialDate | null): DateDraft {
  if (!d) return emptyDateDraft;
  return {
    year: d.year?.toString() ?? "",
    month: d.month?.toString() ?? "",
    day: d.day?.toString() ?? "",
    qualifier: d.qualifier,
  };
}

import { describe, expect, it } from "vitest";

import {
  ageFrom,
  dateToDraft,
  draftToDate,
  eventToDate,
  formatDate,
  hasHiddenParts,
  validateDate,
  validateLifeDates,
  type PartialDate,
} from "./dates";

const d = (year: number | null, month: number | null = null, day: number | null = null, qualifier: PartialDate["qualifier"] = "exact"): PartialDate => ({
  year,
  month,
  day,
  qualifier,
});

const today = new Date(Date.UTC(2026, 10, 20)); // 20 November 2026

describe("validateDate", () => {
  it("accepts full, partial and empty dates", () => {
    expect(validateDate(d(1952, 3, 14), today)).toBeNull();
    expect(validateDate(d(1952), today)).toBeNull();
    expect(validateDate(d(1952, 3), today)).toBeNull();
    expect(validateDate(d(null, 3, 14), today)).toBeNull(); // birthday, year unknown
    expect(validateDate(d(null), today)).toBeNull(); // nothing entered
  });

  it("allows 29 February only in leap years, or when the year is unknown", () => {
    expect(validateDate(d(2000, 2, 29), today)).toBeNull();
    expect(validateDate(d(null, 2, 29), today)).toBeNull();
    expect(validateDate(d(2001, 2, 29), today)).toBe("invalidDate");
  });

  it("rejects incomplete or impossible dates", () => {
    expect(validateDate(d(1952, null, 3), today)).toBe("dayNeedsMonth");
    expect(validateDate(d(null, 3), today)).toBe("needsYearOrDayMonth");
    expect(validateDate(d(1952, 4, 31), today)).toBe("invalidDate");
    expect(validateDate(d(1952, 13), today)).toBe("invalidDate");
  });

  it("rejects future dates, except 'after'", () => {
    expect(validateDate(d(2027), today)).toBe("inFuture");
    expect(validateDate(d(2026, 12, 1), today)).toBe("inFuture");
    expect(validateDate(d(2026, 11, 20), today)).toBeNull();
    expect(validateDate(d(2027, null, null, "after"), today)).toBeNull();
  });

  it("death can't be before birth", () => {
    expect(validateLifeDates(d(1950), d(1940))).toBe("deathBeforeBirth");
    expect(validateLifeDates(d(1950), d(2001))).toBeNull();
    expect(validateLifeDates(d(1950), null)).toBeNull();
  });
});

describe("formatDate in each language", () => {
  it("full dates", () => {
    expect(formatDate(d(1952, 3, 14), "en")).toBe("March 14, 1952");
    expect(formatDate(d(1952, 3, 14), "id")).toBe("14 Maret 1952");
    expect(formatDate(d(1952, 3, 14), "zh-Hans")).toBe("1952年3月14日");
  });

  it("year only, month and year, day and month", () => {
    expect(formatDate(d(1952), "en")).toBe("1952");
    expect(formatDate(d(1952), "zh-Hans")).toBe("1952年");
    expect(formatDate(d(1952, 3), "id")).toBe("Maret 1952");
    expect(formatDate(d(null, 3, 14), "en")).toBe("March 14");
    expect(formatDate(d(null, 3, 14), "zh-Hans")).toBe("3月14日");
  });
});

describe("ageFrom", () => {
  it("counts whether this year's birthday has passed", () => {
    expect(ageFrom(d(1985, 3, 14), today)).toEqual({ age: 41, approximate: false });
    expect(ageFrom(d(1985, 12, 1), today)).toEqual({ age: 40, approximate: false });
  });

  it("is approximate with only a year or an 'about' date", () => {
    expect(ageFrom(d(1985), today)).toEqual({ age: 41, approximate: true });
    expect(ageFrom(d(1985, 3, 14, "about"), today)).toEqual({ age: 41, approximate: true });
  });

  it("gives nothing without a year or for before/after dates", () => {
    expect(ageFrom(d(null, 3, 14), today)).toBeNull();
    expect(ageFrom(d(1985, null, null, "before"), today)).toBeNull();
  });
});

describe("events and form drafts", () => {
  it("reads visible parts and spots hidden day/month", () => {
    const hidden = { type: "birth" as const, year: 1985, qualifier: "exact" as const, has_full_date: true, event_dates: null };
    expect(eventToDate(hidden)).toEqual(d(1985));
    expect(hasHiddenParts(hidden)).toBe(true);
    const shown = { ...hidden, event_dates: [{ month: 3, day: 14 }] };
    expect(eventToDate(shown)).toEqual(d(1985, 3, 14));
    expect(hasHiddenParts(shown)).toBe(false);
  });

  it("round-trips through the form fields", () => {
    expect(draftToDate(dateToDraft(d(1952, 3, 14, "about")))).toEqual(d(1952, 3, 14, "about"));
    expect(draftToDate({ year: " 1952 ", month: "", day: "", qualifier: "exact" })).toEqual(d(1952));
    expect(draftToDate({ year: "abc", month: "", day: "", qualifier: "exact" })).toEqual(d(null));
  });
});

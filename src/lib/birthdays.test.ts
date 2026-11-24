import { describe, expect, it } from "vitest";

import { birthdayIn, nextBirthday, upcomingBirthdays, type BirthdayRow } from "./birthdays";

const row = (month: number, day: number, year: number | null = null, id = "p"): BirthdayRow => ({
  person_id: id,
  tree_id: "t",
  month,
  day,
  year,
});
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 15, 30); // afternoon

describe("nextBirthday", () => {
  it("is today when it's today", () => {
    expect(nextBirthday(row(11, 21, 1990), d(2026, 11, 21))).toMatchObject({ daysAway: 0, turning: 36 });
  });

  it("counts days ahead, and moves to next year once it has passed", () => {
    expect(nextBirthday(row(11, 23), d(2026, 11, 21)).daysAway).toBe(2);
    const passed = nextBirthday(row(1, 5, 2000), d(2026, 11, 21));
    expect(passed.date.getFullYear()).toBe(2027);
    expect(passed.turning).toBe(27);
  });

  it("handles 29 February", () => {
    expect(birthdayIn(2027, 2, 29)).toEqual(new Date(2027, 1, 28));
    expect(birthdayIn(2028, 2, 29)).toEqual(new Date(2028, 1, 29));
  });

  it("works across the new year", () => {
    expect(nextBirthday(row(1, 2), d(2026, 12, 30)).daysAway).toBe(3);
  });

  it("has no age without a birth year", () => {
    expect(nextBirthday(row(3, 1), d(2026, 1, 1)).turning).toBeNull();
  });
});

describe("upcomingBirthdays", () => {
  it("keeps the next 30 days, soonest first", () => {
    const list = upcomingBirthdays(
      [row(12, 25, null, "xmas"), row(11, 21, null, "today"), row(11, 30, null, "soon"), row(6, 1, null, "june")],
      d(2026, 11, 21),
    );
    expect(list.map((b) => b.person_id)).toEqual(["today", "soon"]);
    expect(upcomingBirthdays([row(12, 25, null, "xmas")], d(2026, 11, 21), 60).length).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import {
  detectScript,
  everydayName,
  formatFullName,
  guessNameLang,
  isFamilyFirstByDefault,
  knownAs,
  nickname,
  splitSavedName,
} from "./names";
import type { NameType } from "./trees";

describe("detectScript", () => {
  it("recognises Chinese characters", () => {
    expect(detectScript("陈", "美玲")).toBe("Hani");
    expect(detectScript("陳美玲")).toBe("Hani"); // Traditional too
  });

  it("recognises Latin letters, including accents", () => {
    expect(detectScript("Mei Ling", "Tan")).toBe("Latn");
    expect(detectScript("Đặng")).toBe("Latn");
  });

  it("returns null when there is nothing to go on", () => {
    expect(detectScript("", null, undefined)).toBeNull();
    expect(detectScript("123")).toBeNull();
  });
});

describe("defaults per script", () => {
  it("Chinese names are family name first and tagged zh", () => {
    expect(isFamilyFirstByDefault("Hani")).toBe(true);
    expect(guessNameLang("Hani")).toBe("zh");
  });

  it("Latin names are given name first with no language guess", () => {
    expect(isFamilyFirstByDefault("Latn")).toBe(false);
    expect(guessNameLang("Latn")).toBeNull();
  });
});

describe("formatFullName", () => {
  it("writes Chinese names family first without a space", () => {
    expect(formatFullName({ given: "美玲", family: "陈", familyFirst: true })).toBe("陈美玲");
  });

  it("writes Latin names given first by default", () => {
    expect(formatFullName({ given: "Mei Ling", family: "Tan", familyFirst: false })).toBe("Mei Ling Tan");
  });

  it("can put a Latin family name first, with a space", () => {
    expect(formatFullName({ given: "Chee Beng", family: "Tan", familyFirst: true })).toBe("Tan Chee Beng");
  });

  it("handles single names (common in Indonesia)", () => {
    expect(formatFullName({ given: "Sukarno", family: "", familyFirst: false })).toBe("Sukarno");
    expect(formatFullName({ given: "", family: "Wijaya", familyFirst: false })).toBe("Wijaya");
  });

  it("tidies extra spaces", () => {
    expect(formatFullName({ given: "  Siti   Aminah ", family: " ", familyFirst: false })).toBe("Siti Aminah");
  });
});

describe("splitSavedName (for editing)", () => {
  it("recovers the display order from the saved full name", () => {
    expect(splitSavedName({ given: "美玲", family: "陈", full_display: "陈美玲" }))
      .toEqual({ given: "美玲", family: "陈", familyFirst: true });
    expect(splitSavedName({ given: "Mei Ling", family: "Tan", full_display: "Tan Mei Ling" }))
      .toEqual({ given: "Mei Ling", family: "Tan", familyFirst: true });
    expect(splitSavedName({ given: "Mei Ling", family: "Tan", full_display: "Mei Ling Tan" }))
      .toEqual({ given: "Mei Ling", family: "Tan", familyFirst: false });
  });

  it("keeps a name that only has a full form", () => {
    expect(splitSavedName({ given: null, family: null, full_display: "Ah Kow" }))
      .toEqual({ given: "Ah Kow", family: "", familyFirst: false });
  });

  it("round-trips: splitting then formatting gives the same name", () => {
    for (const full of ["陈美玲", "Tan Mei Ling", "Mei Ling Tan"]) {
      const saved =
        full === "陈美玲" ? { given: "美玲", family: "陈" } : { given: "Mei Ling", family: "Tan" };
      expect(formatFullName(splitSavedName({ ...saved, full_display: full }))).toBe(full);
    }
  });
});

describe("everyday names", () => {
  const person = (names: { full_display: string; is_primary: boolean; type: NameType }[]) => ({
    person_names: names.map((n) => ({ ...n, script: null })),
  });

  it("prefer the nickname, then the main name", () => {
    expect(
      everydayName(
        person([
          { full_display: "Tan Mei Ling", is_primary: true, type: "birth" },
          { full_display: "Meimei", is_primary: false, type: "nickname" },
        ]),
      ),
    ).toBe("Meimei");
    expect(everydayName(person([{ full_display: "Tan Mei Ling", is_primary: true, type: "birth" }]))).toBe("Tan Mei Ling");
    expect(nickname(person([{ full_display: "Mei", is_primary: false, type: "aka" }]))).toBeNull();
  });

  it("use an 'also known as' name when there is no nickname", () => {
    const aka = person([
      { full_display: "洪德义", is_primary: true, type: "birth" },
      { full_display: "David", is_primary: false, type: "aka" },
    ]);
    expect(everydayName(aka)).toBe("David");
    expect(knownAs(aka)).toBe("David");
    const both = person([
      { full_display: "洪德梅", is_primary: true, type: "birth" },
      { full_display: "Mary", is_primary: false, type: "aka" },
      { full_display: "Mui", is_primary: false, type: "nickname" },
    ]);
    expect(everydayName(both)).toBe("Mui");
    expect(knownAs(person([{ full_display: "Tan", is_primary: true, type: "birth" }]))).toBeNull();
  });
});

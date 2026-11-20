import { describe, expect, it } from "vitest";

import { KinGraph, labelFor, labelsForTree, type KinLink, type KinPerson } from "./index";

/**
 * A made-up family, seen from "me" (female, born 1985):
 *
 *   gpaF ─ gmaF                      gpaM ─ gmaM
 *      ├── uncleOld (1950) ─ auntInLaw   ├── uncleM
 *      │      └── cousinP (1980, m)      │      └── cousinM (1990, f)
 *      ├── dad (1955)  ════════════════ mum (1958)
 *      ├── uncleYoung (1960)             └── auntM
 *      ├── uncleUnknownAge
 *      └── auntF
 *   dad + mum → brother (1982), me (1985), sister (1990, explicit sibling link only)
 *   brother ─ sisterInLaw;  me ─ husband;  husband's parents: fil, mil
 *   me → son ─ daughterInLaw → grandson;  me → daughter → grandsonViaDaughter
 *   me → nephew? no: brother → niece;  friend: pal
 */
const P = (id: string, sex: KinPerson["sex"], birthYear: number | null = null): KinPerson => ({
  id,
  sex,
  birthYear,
  birthOrder: null,
});

const people: KinPerson[] = [
  P("me", "female", 1985),
  P("dad", "male", 1955), P("mum", "female", 1958),
  P("gpaF", "male"), P("gmaF", "female"), P("gpaM", "male"), P("gmaM", "female"),
  P("uncleOld", "male", 1950), P("uncleYoung", "male", 1960), P("uncleUnknownAge", "male"),
  P("auntF", "female"), P("uncleM", "male"), P("auntM", "female"), P("auntInLaw", "female"),
  P("cousinP", "male", 1980), P("cousinM", "female", 1990),
  P("brother", "male", 1982), P("sister", "female", 1990), P("sisterInLaw", "female"),
  P("husband", "male", 1983), P("fil", "male"), P("mil", "female"),
  P("son", "male", 2010), P("daughterInLaw", "female"), P("grandson", "male"),
  P("daughter", "female", 2012), P("grandsonViaDaughter", "male"),
  P("niece", "female"), P("pal", "unknown"), P("stranger", "male"),
];

const parent = (a: string, b: string, subtype = "biological"): KinLink => ({ type: "parent", subtype, person_a: a, person_b: b });
const pair = (type: KinLink["type"], x: string, y: string, subtype: string | null): KinLink => {
  const [a, b] = x < y ? [x, y] : [y, x];
  return { type, subtype, person_a: a, person_b: b };
};

const links: KinLink[] = [
  parent("gpaF", "dad"), parent("gmaF", "dad"),
  parent("gpaF", "uncleOld"), parent("gpaF", "uncleYoung"), parent("gpaF", "uncleUnknownAge"), parent("gpaF", "auntF"),
  parent("gpaM", "mum"), parent("gmaM", "mum"), parent("gpaM", "uncleM"), parent("gpaM", "auntM"),
  parent("uncleOld", "cousinP"), parent("uncleM", "cousinM"),
  pair("partner", "uncleOld", "auntInLaw", "married"),
  pair("partner", "dad", "mum", "married"),
  parent("dad", "me"), parent("mum", "me"), parent("dad", "brother"), parent("mum", "brother"),
  pair("sibling", "me", "sister", "full"),
  pair("partner", "brother", "sisterInLaw", "married"),
  pair("partner", "me", "husband", "married"),
  parent("fil", "husband"), parent("mil", "husband"),
  parent("me", "son"), parent("husband", "son"), pair("partner", "son", "daughterInLaw", "married"), parent("son", "grandson"),
  parent("me", "daughter"), parent("daughter", "grandsonViaDaughter"),
  parent("brother", "niece"),
  pair("friend", "me", "pal", null),
];

const graph = new KinGraph(people, links);

/** [English, Indonesian, Chinese] term (or description when there's no term). */
function words(target: string) {
  const path = graph.findPath("me", target);
  if (!path) return null;
  return (["en", "id", "zh-Hans"] as const).map((lang) => {
    const label = labelFor(path, lang);
    return label.term ?? `(${label.description})`;
  });
}

describe("kinship words in three languages", () => {
  it("parents and grandparents, by side of the family", () => {
    expect(words("dad")).toEqual(["Father", "Ayah", "父亲"]);
    expect(words("mum")).toEqual(["Mother", "Ibu", "母亲"]);
    expect(words("gpaF")).toEqual(["Grandfather", "Kakek", "祖父"]);
    expect(words("gmaM")).toEqual(["Grandmother", "Nenek", "外祖母"]);
  });

  it("siblings: elder or younger, through shared parents or a direct link", () => {
    expect(words("brother")).toEqual(["Brother", "Kakak laki-laki", "哥哥"]);
    expect(words("sister")).toEqual(["Sister", "Adik perempuan", "妹妹"]);
  });

  it("father's elder brother is uncle / paman / 伯父 (the plan's example)", () => {
    expect(words("uncleOld")).toEqual(["Uncle", "Paman", "伯父"]);
    expect(words("uncleYoung")).toEqual(["Uncle", "Paman", "叔父"]);
    expect(words("auntF")).toEqual(["Aunt", "Bibi", "姑母"]);
    expect(words("uncleM")).toEqual(["Uncle", "Paman", "舅父"]);
    expect(words("auntM")).toEqual(["Aunt", "Bibi", "姨母"]);
    expect(words("auntInLaw")).toEqual(["Aunt", "Bibi", "伯母"]);
  });

  it("falls back to a description when elder/younger is unknown", () => {
    expect(words("uncleUnknownAge")).toEqual(["Uncle", "Paman", "(父亲的兄弟)"]);
    const path = graph.findPath("me", "uncleUnknownAge")!;
    expect(labelFor(path, "en").description).toBe("Father's brother");
    expect(labelFor(path, "id").description).toBe("Saudara laki-laki dari ayah");
  });

  it("cousins: 堂 on the father's brother's side, 表 otherwise, elder or younger than me", () => {
    expect(words("cousinP")).toEqual(["Cousin", "Sepupu", "堂兄"]);
    expect(words("cousinM")).toEqual(["Cousin", "Sepupu", "表妹"]);
  });

  it("partners and in-laws", () => {
    expect(words("husband")).toEqual(["Husband", "Suami", "丈夫"]);
    expect(words("fil")).toEqual(["Father-in-law", "Ayah mertua", "公公"]);
    expect(words("mil")).toEqual(["Mother-in-law", "Ibu mertua", "婆婆"]);
    expect(words("sisterInLaw")).toEqual(["Sister-in-law", "Kakak ipar", "嫂子"]);
    expect(words("daughterInLaw")).toEqual(["Daughter-in-law", "Menantu", "儿媳"]);
  });

  it("children, grandchildren, nephews and nieces", () => {
    expect(words("son")).toEqual(["Son", "Anak laki-laki", "儿子"]);
    expect(words("grandson")).toEqual(["Grandson", "Cucu", "孙子"]);
    expect(words("grandsonViaDaughter")).toEqual(["Grandson", "Cucu", "外孙"]);
    expect(words("niece")).toEqual(["Niece", "Keponakan", "侄女"]);
  });

  it("friends, and people not connected", () => {
    expect(words("pal")).toEqual(["Friend", "Teman", "朋友"]);
    expect(words("stranger")).toBeNull();
  });

  it("descriptions read naturally in each language", () => {
    const path = graph.findPath("me", "cousinP")!;
    expect(labelFor(path, "en").description).toBe("Father's elder brother's son");
    expect(labelFor(path, "id").description).toBe("Anak laki-laki dari kakak laki-laki dari ayah");
    expect(labelFor(path, "zh-Hans").description).toBe("父亲的哥哥的儿子");
  });
});

describe("path finding", () => {
  it("prefers blood relations over marriage when both are as short", () => {
    // son is my child directly, not "husband's son".
    expect(graph.findPath("me", "son")!.steps.map((s) => s.kind)).toEqual(["child"]);
  });

  it("step-parents and half siblings", () => {
    const g = new KinGraph(
      [P("me", "male"), P("mum", "female"), P("dad", "male"), P("stepdad", "male"), P("half", "female", 2000), P("dad2", "male")],
      [
        parent("mum", "me"), parent("dad", "me"),
        pair("partner", "mum", "stepdad", "married"),
        parent("mum", "half"), parent("dad2", "half"),
      ],
    );
    expect(labelFor(g.findPath("me", "stepdad")!, "en").term).toBe("Stepfather");
    expect(labelFor(g.findPath("me", "stepdad")!, "zh-Hans").term).toBe("继父");
    expect(labelFor(g.findPath("me", "half")!, "en").term).toBe("Half-sister");
  });

  it("labelsForTree labels everyone connected, or no one without a profile", () => {
    const labels = labelsForTree("me", people, links, "en");
    expect(labels.get("uncleOld")!.term).toBe("Uncle");
    expect(labels.has("me")).toBe(false);
    expect(labels.has("stranger")).toBe(false);
    expect(labelsForTree(null, people, links, "en").size).toBe(0);
  });

  it("uses birth order when birth years are missing", () => {
    const g = new KinGraph(
      [{ ...P("me", "female"), birthOrder: 2 }, P("mum", "female"), { ...P("bro", "male"), birthOrder: 1 }],
      [parent("mum", "me"), parent("mum", "bro")],
    );
    expect(labelFor(g.findPath("me", "bro")!, "zh-Hans").term).toBe("哥哥");
  });
});

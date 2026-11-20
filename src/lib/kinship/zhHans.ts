import { pathCode, type KinPath, type KinSex, type Step } from "./path";

/** male / female / other-or-unknown */
const g = (sex: KinSex, male: string, female: string, neutral: string | null) =>
  sex === "male" ? male : sex === "female" ? female : neutral;

/** 兄/弟/姐/妹 by sex and elder/younger, or null if either is unknown. */
const sibling = (sex: KinSex, elder: boolean | null) =>
  elder === null ? null : g(sex, elder ? "兄" : "弟", elder ? "姐" : "妹", null);

/**
 * Formal Simplified Chinese terms (decided). Many depend on which side of the
 * family (father's or mother's) and on elder/younger; when that's unknown,
 * there's no term and the description is shown instead.
 */
export function termZhHans(path: KinPath): string | null {
  const s = path.steps;
  const last = s[s.length - 1]!;
  const first = s[0]!;
  switch (pathCode(path)) {
    case "F":
      return "朋友";
    case "P":
      return last.subtype === "step" ? g(last.sex, "继父", "继母", null) : g(last.sex, "父亲", "母亲", null);
    case "C":
      return last.subtype === "step" ? g(last.sex, "继子", "继女", null) : g(last.sex, "儿子", "女儿", null);
    case "S":
      if (last.subtype === "divorced") return g(last.sex, "前夫", "前妻", null);
      if (last.subtype === "unmarried") return "伴侣";
      return g(last.sex, "丈夫", "妻子", "配偶");
    case "B": {
      if (last.subtype === "step") {
        const w = sibling(last.sex, last.elder);
        return w ? `继${w}` : null;
      }
      return last.elder === null ? null : g(last.sex, last.elder ? "哥哥" : "弟弟", last.elder ? "姐姐" : "妹妹", null);
    }
    case "PP":
      if (first.sex === "male") return g(last.sex, "祖父", "祖母", null);
      if (first.sex === "female") return g(last.sex, "外祖父", "外祖母", null);
      return null;
    case "PPP":
      if (first.sex === "female") return g(last.sex, "外曾祖父", "外曾祖母", null);
      if (first.sex === "male" && s[1]!.sex === "male") return g(last.sex, "曾祖父", "曾祖母", null);
      return null;
    case "CC":
      if (first.sex === "male") return g(last.sex, "孙子", "孙女", null);
      if (first.sex === "female") return g(last.sex, "外孙", "外孙女", null);
      return null;
    case "CCC":
      return g(last.sex, "曾孙", "曾孙女", null);
    case "PB":
      return uncleAunt(first.sex, s[1]!);
    case "PBS": {
      // The spouse of an uncle or aunt.
      const ua = uncleAunt(first.sex, s[1]!);
      const spouseOf: Record<string, string> = { 伯父: "伯母", 叔父: "婶母", 姑母: "姑父", 舅父: "舅母", 姨母: "姨父" };
      return ua ? (spouseOf[ua] ?? null) : null;
    }
    case "PBC": {
      // Father's brother's children are 堂; all other cousins are 表.
      const prefix = first.sex === "male" && s[1]!.sex === "male" ? "堂" : first.sex === "unknown" || s[1]!.sex === "unknown" ? null : "表";
      const w = sibling(last.sex, path.targetElder);
      return prefix && w ? `${prefix}${w}` : null;
    }
    case "BC":
      if (first.sex === "male") return g(last.sex, "侄子", "侄女", null);
      if (first.sex === "female") return g(last.sex, "外甥", "外甥女", null);
      return null;
    case "SP":
      if (first.sex === "male") return g(last.sex, "公公", "婆婆", null); // husband's parents
      if (first.sex === "female") return g(last.sex, "岳父", "岳母", null); // wife's parents
      return null;
    case "CS":
      if (first.sex === "male" && last.sex === "female") return "儿媳";
      if (first.sex === "female" && last.sex === "male") return "女婿";
      return null;
    case "BS":
      if (first.elder === null) return null;
      if (first.sex === "male" && last.sex === "female") return first.elder ? "嫂子" : "弟媳";
      if (first.sex === "female" && last.sex === "male") return first.elder ? "姐夫" : "妹夫";
      return null;
    case "PS":
      return g(last.sex, "继父", "继母", null);
    case "SC":
      return g(last.sex, "继子", "继女", null);
  }
  return null;
}

function uncleAunt(parentSex: KinSex, sib: Step): string | null {
  if (parentSex === "male") {
    if (sib.sex === "female") return "姑母";
    if (sib.sex === "male") return sib.elder === true ? "伯父" : sib.elder === false ? "叔父" : null;
  }
  if (parentSex === "female") {
    if (sib.sex === "male") return "舅父";
    if (sib.sex === "female") return "姨母";
  }
  return null;
}

function stepWord(step: Step): string {
  switch (step.kind) {
    case "parent":
      return g(step.sex, "父亲", "母亲", "父母")!;
    case "child":
      return g(step.sex, "儿子", "女儿", "子女")!;
    case "spouse":
      return g(step.sex, "丈夫", "妻子", "配偶")!;
    case "friend":
      return "朋友";
    case "sibling":
      if (step.elder === null) return g(step.sex, "兄弟", "姐妹", "兄弟姐妹")!;
      return g(step.sex, step.elder ? "哥哥" : "弟弟", step.elder ? "姐姐" : "妹妹", "兄弟姐妹")!;
  }
}

/** A plain description, e.g. "父亲的哥哥" (father's elder brother). */
export function describeZhHans(path: KinPath): string {
  return path.steps.map(stepWord).join("的");
}

import { pathCode, type KinPath, type KinSex, type Step } from "./path";

/** male / female / other-or-unknown */
const g = (sex: KinSex, male: string, female: string, neutral: string | null) =>
  sex === "male" ? male : sex === "female" ? female : neutral;

/** The English word for a path, or null when there isn't a fitting one. */
export function termEn(path: KinPath): string | null {
  const s = path.steps;
  const last = s[s.length - 1]!;
  switch (pathCode(path)) {
    case "F":
      return "friend";
    case "P":
      return last.subtype === "step"
        ? g(last.sex, "stepfather", "stepmother", "step-parent")
        : g(last.sex, "father", "mother", "parent");
    case "C":
      return last.subtype === "step"
        ? g(last.sex, "stepson", "stepdaughter", "stepchild")
        : g(last.sex, "son", "daughter", "child");
    case "S":
      if (last.subtype === "divorced") return g(last.sex, "former husband", "former wife", "former partner");
      if (last.subtype === "unmarried") return "partner";
      return g(last.sex, "husband", "wife", "spouse");
    case "B":
      if (last.subtype === "half") return g(last.sex, "half-brother", "half-sister", "half-sibling");
      if (last.subtype === "step") return g(last.sex, "stepbrother", "stepsister", "step-sibling");
      return g(last.sex, "brother", "sister", "sibling");
    case "PP":
      return g(last.sex, "grandfather", "grandmother", "grandparent");
    case "PPP":
      return g(last.sex, "great-grandfather", "great-grandmother", "great-grandparent");
    case "CC":
      return g(last.sex, "grandson", "granddaughter", "grandchild");
    case "CCC":
      return g(last.sex, "great-grandson", "great-granddaughter", "great-grandchild");
    case "PB":
    case "PBS":
      return g(last.sex, "uncle", "aunt", null);
    case "PBC":
      return "cousin";
    case "BC":
      return g(last.sex, "nephew", "niece", null);
    case "SP":
      return g(last.sex, "father-in-law", "mother-in-law", "parent-in-law");
    case "CS":
      return g(last.sex, "son-in-law", "daughter-in-law", "child-in-law");
    case "BS":
    case "SB":
      return g(last.sex, "brother-in-law", "sister-in-law", "sibling-in-law");
    case "PS":
      return g(last.sex, "stepfather", "stepmother", "step-parent");
    case "SC":
      return g(last.sex, "stepson", "stepdaughter", "stepchild");
  }
  return null;
}

function stepWord(step: Step): string {
  switch (step.kind) {
    case "parent":
      return g(step.sex, "father", "mother", "parent")!;
    case "child":
      return g(step.sex, "son", "daughter", "child")!;
    case "spouse":
      return g(step.sex, "husband", "wife", "partner")!;
    case "friend":
      return "friend";
    case "sibling": {
      const base = g(step.sex, "brother", "sister", "sibling")!;
      return step.elder === null ? base : `${step.elder ? "elder" : "younger"} ${base}`;
    }
  }
}

/** A plain description of the path, e.g. "father's elder brother". */
export function describeEn(path: KinPath): string {
  return path.steps.map(stepWord).join("'s ");
}

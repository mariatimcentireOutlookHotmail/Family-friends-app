import { pathCode, type KinPath, type KinSex, type Step } from "./path";

/** male / female / other-or-unknown */
const g = (sex: KinSex, male: string, female: string, neutral: string | null) =>
  sex === "male" ? male : sex === "female" ? female : neutral;

/**
 * Standard Indonesian terms (decided: no regional Javanese Pakde/Bude for now,
 * so uncles and aunts don't depend on elder/younger).
 */
export function termId(path: KinPath): string | null {
  const s = path.steps;
  const last = s[s.length - 1]!;
  switch (pathCode(path)) {
    case "F":
      return "teman";
    case "P":
      return last.subtype === "step"
        ? g(last.sex, "ayah tiri", "ibu tiri", "orang tua tiri")
        : g(last.sex, "ayah", "ibu", "orang tua");
    case "C":
      return last.subtype === "step" ? "anak tiri" : g(last.sex, "anak laki-laki", "anak perempuan", "anak");
    case "S":
      if (last.subtype === "divorced") return g(last.sex, "mantan suami", "mantan istri", "mantan pasangan");
      if (last.subtype === "unmarried") return "pasangan";
      return g(last.sex, "suami", "istri", "pasangan");
    case "B":
      if (last.subtype === "half" || last.subtype === "step") return "saudara tiri";
      if (last.elder === true) return g(last.sex, "kakak laki-laki", "kakak perempuan", "kakak");
      if (last.elder === false) return g(last.sex, "adik laki-laki", "adik perempuan", "adik");
      return g(last.sex, "saudara laki-laki", "saudara perempuan", "saudara");
    case "PP":
      return g(last.sex, "kakek", "nenek", null);
    case "PPP":
      return g(last.sex, "kakek buyut", "nenek buyut", "buyut");
    case "CC":
      return "cucu";
    case "CCC":
      return "cicit";
    case "PB":
    case "PBS":
      return g(last.sex, "paman", "bibi", null);
    case "PBC":
      return "sepupu";
    case "BC":
      return "keponakan";
    case "SP":
      return g(last.sex, "ayah mertua", "ibu mertua", "mertua");
    case "CS":
      return "menantu";
    case "BS": {
      // Named after the sibling: an elder sibling's spouse is "kakak ipar".
      const sibling = s[0]!;
      return sibling.elder === true ? "kakak ipar" : sibling.elder === false ? "adik ipar" : "ipar";
    }
    case "SB":
      return last.elder === true ? "kakak ipar" : last.elder === false ? "adik ipar" : "ipar";
    case "PS":
      return g(last.sex, "ayah tiri", "ibu tiri", "orang tua tiri");
    case "SC":
      return "anak tiri";
  }
  return null;
}

function stepWord(step: Step): string {
  switch (step.kind) {
    case "parent":
      return g(step.sex, "ayah", "ibu", "orang tua")!;
    case "child":
      return g(step.sex, "anak laki-laki", "anak perempuan", "anak")!;
    case "spouse":
      return g(step.sex, "suami", "istri", "pasangan")!;
    case "friend":
      return "teman";
    case "sibling":
      if (step.elder === true) return g(step.sex, "kakak laki-laki", "kakak perempuan", "kakak")!;
      if (step.elder === false) return g(step.sex, "adik laki-laki", "adik perempuan", "adik")!;
      return g(step.sex, "saudara laki-laki", "saudara perempuan", "saudara")!;
  }
}

/** A plain description, e.g. "kakak laki-laki dari ayah" (father's elder brother). */
export function describeId(path: KinPath): string {
  return path.steps.map(stepWord).reverse().join(" dari ");
}

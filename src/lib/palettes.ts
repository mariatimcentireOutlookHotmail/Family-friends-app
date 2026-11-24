/**
 * Colour themes. The whole app is styled with Tailwind's `gray-*`, `indigo-*`,
 * `white` and `black` classes; tailwind.config.js points those at CSS
 * variables, and each palette fills the variables in. So a palette changes
 * the look everywhere without touching any screen, in light and dark mode.
 *
 *   gray   = the neutrals (page backgrounds, cards, text, borders);
 *            gray-900/950 and black are the dark-mode backgrounds
 *   indigo = the accent (buttons, links, the selected chip)
 *
 * Adding a palette: add it here and give it a name in the settings translations.
 */

export const PALETTES = ["indigo", "sky", "sage", "earth"] as const;
export type PaletteName = (typeof PALETTES)[number];

const STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
type Scale = Record<(typeof STEPS)[number], string>;

export type Palette = { gray: Scale; accent: Scale; white: string; black: string };

const scale = (hex: string[]): Scale =>
  Object.fromEntries(STEPS.map((s, i) => [s, hex[i]!])) as Scale;

export const PALETTE_COLORS: Record<PaletteName, Palette> = {
  // The original look: neutral grey and indigo.
  indigo: {
    gray: scale(["#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827", "#030712"]),
    accent: scale(["#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81", "#1e1b4b"]),
    white: "#ffffff",
    black: "#000000",
  },
  // Light blue by day, deep navy at night.
  sky: {
    gray: scale(["#f5f9fc", "#eaf2f8", "#d7e4ee", "#b8cddd", "#8ba8c0", "#64819b", "#4b657d", "#3a5066", "#1e3047", "#132238", "#0a1628"]),
    accent: scale(["#eff9ff", "#dbf0fe", "#bfe5fd", "#93d4fb", "#5fbaf6", "#3a9eef", "#2581d9", "#1f69b4", "#1e5893", "#1d4a78", "#152f4d"]),
    white: "#ffffff",
    black: "#050d1a",
  },
  // Soft green by day, deep forest at night.
  sage: {
    gray: scale(["#f6f8f5", "#ebf0e9", "#d7e0d4", "#b9c8b4", "#8fa58a", "#6c8468", "#546a51", "#425540", "#2a3a2a", "#1b281c", "#0f1810"]),
    accent: scale(["#eefbf3", "#d6f5e1", "#b0eac7", "#7dd8a6", "#47bf81", "#24a366", "#178452", "#146944", "#135438", "#11452f", "#08271b"]),
    white: "#ffffff",
    black: "#070d08",
  },
  // Sand and terracotta by day, dark earth at night.
  earth: {
    gray: scale(["#faf7f2", "#f3ede4", "#e6dccd", "#d2c3ad", "#b09d84", "#8b7863", "#6d5d4c", "#56493c", "#372e25", "#241e18", "#14100c"]),
    accent: scale(["#fdf5f1", "#fae7dd", "#f4cbb6", "#eaa587", "#dd7d58", "#cc5f3a", "#b04a2c", "#8f3b25", "#733223", "#5e2b20", "#33140e"]),
    white: "#fffdf9",
    black: "#0b0806",
  },
};

/** "#4f46e5" → "79 70 229" (the form the CSS variables use). */
export function hexToRgbChannels(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** The CSS variables for a palette, e.g. { "--gray-50": "249 250 251", ... }. */
export function paletteVars(name: PaletteName): Record<string, string> {
  const p = PALETTE_COLORS[name];
  const out: Record<string, string> = {
    "--white": hexToRgbChannels(p.white),
    "--black": hexToRgbChannels(p.black),
  };
  for (const s of STEPS) {
    out[`--gray-${s}`] = hexToRgbChannels(p.gray[s]);
    out[`--accent-${s}`] = hexToRgbChannels(p.accent[s]);
  }
  return out;
}

export const isPaletteName = (v: unknown): v is PaletteName =>
  typeof v === "string" && (PALETTES as readonly string[]).includes(v);

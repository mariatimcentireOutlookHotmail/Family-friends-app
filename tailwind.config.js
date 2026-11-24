/** @type {import('tailwindcss').Config} */

// gray, indigo, white and black come from CSS variables, so the colour theme
// (src/lib/palettes.ts) can change them. "indigo" is the accent colour.
const STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const fromVars = (name) =>
  Object.fromEntries(STEPS.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  // Lets the in-app Appearance setting override the system (also on the web).
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        gray: fromVars("gray"),
        indigo: fromVars("accent"),
        white: "rgb(var(--white) / <alpha-value>)",
        black: "rgb(var(--black) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};

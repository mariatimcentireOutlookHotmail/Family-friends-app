/** Helpers for invite codes as people type them (no app dependencies, so easy to test). */

/** "k7qm 3xpa9htd" → "K7QM-3XPA-9HTD" (as far as typed). */
export function formatCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return raw.match(/.{1,4}/g)?.join("-") ?? "";
}

export const isCompleteCode = (code: string) => code.replace(/-/g, "").length === 12;

import { describe, expect, it } from "vitest";

import { formatCode, isCompleteCode } from "./inviteCodes";

describe("invite codes as typed", () => {
  it("are tidied into XXXX-XXXX-XXXX", () => {
    expect(formatCode("k7qm3xpa9htd")).toBe("K7QM-3XPA-9HTD");
    expect(formatCode(" k7qm 3xpa-9htd ")).toBe("K7QM-3XPA-9HTD");
    expect(formatCode("k7q")).toBe("K7Q");
    expect(formatCode("K7QM-3XPA-9HTD-EXTRA")).toBe("K7QM-3XPA-9HTD");
    expect(formatCode("")).toBe("");
  });

  it("are complete at 12 characters", () => {
    expect(isCompleteCode("K7QM-3XPA-9HTD")).toBe(true);
    expect(isCompleteCode("K7QM-3XPA-9HT")).toBe(false);
  });
});

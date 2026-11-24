import { describe, expect, it } from "vitest";

import { joinCodeFromUrl, joinLink } from "./joinLinks";

describe("joinLink", () => {
  it("builds a link to the join screen", () => {
    expect(joinLink("K7QM-3XPA-9HTD", "https://myorbit.click/")).toBe("https://myorbit.click/join?code=K7QM-3XPA-9HTD");
  });
});

describe("joinCodeFromUrl", () => {
  it("reads the code from website, app and Expo Go links", () => {
    expect(joinCodeFromUrl("https://myorbit.click/join?code=K7QM-3XPA-9HTD")).toBe("K7QM-3XPA-9HTD");
    expect(joinCodeFromUrl("https://www.myorbit.click/join/?code=k7qm3xpa9htd")).toBe("K7QM-3XPA-9HTD");
    expect(joinCodeFromUrl("myorbit://join?code=K7QM-3XPA-9HTD")).toBe("K7QM-3XPA-9HTD");
    expect(joinCodeFromUrl("exp://192.168.1.5:8081/--/join?code=K7QM-3XPA-9HTD#x")).toBe("K7QM-3XPA-9HTD");
  });

  it("ignores other pages and incomplete codes", () => {
    expect(joinCodeFromUrl("https://myorbit.click/")).toBeNull();
    expect(joinCodeFromUrl("https://myorbit.click/person/1?code=K7QM-3XPA-9HTD")).toBeNull();
    expect(joinCodeFromUrl("https://myorbit.click/rejoin?code=K7QM-3XPA-9HTD")).toBeNull();
    expect(joinCodeFromUrl("https://myorbit.click/join?code=K7QM")).toBeNull();
    expect(joinCodeFromUrl("https://myorbit.click/join")).toBeNull();
    expect(joinCodeFromUrl(null)).toBeNull();
  });
});

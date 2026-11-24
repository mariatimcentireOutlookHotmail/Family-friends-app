import { describe, expect, it } from "vitest";

import { socialEntries, socialUrl } from "./social";

describe("socialUrl", () => {
  it("builds profile links from usernames, with or without @", () => {
    expect(socialUrl("instagram", "@meitan")).toBe("https://instagram.com/meitan");
    expect(socialUrl("x", "meitan")).toBe("https://x.com/meitan");
    expect(socialUrl("tiktok", "@mei.tan")).toBe("https://www.tiktok.com/@mei.tan");
    expect(socialUrl("linkedin", "mei-tan-123")).toBe("https://www.linkedin.com/in/mei-tan-123");
    expect(socialUrl("telegram", "meitan")).toBe("https://t.me/meitan");
    expect(socialUrl("line", "mei.tan")).toBe("https://line.me/ti/p/~mei.tan");
    expect(socialUrl("facebook", "mei.tan.5")).toBe("https://facebook.com/mei.tan.5");
  });

  it("turns a WhatsApp number into a wa.me link", () => {
    expect(socialUrl("whatsapp", "+62 811-1234-567")).toBe("https://wa.me/628111234567");
    expect(socialUrl("whatsapp", "12")).toBeNull();
  });

  it("has no link for WeChat IDs", () => {
    expect(socialUrl("wechat", "mei_wx")).toBeNull();
  });

  it("accepts pasted links only on the platform's own site", () => {
    expect(socialUrl("linkedin", "https://www.linkedin.com/in/meitan/")).toBe("https://www.linkedin.com/in/meitan/");
    expect(socialUrl("instagram", "https://evil.example/instagram.com")).toBeNull();
    expect(socialUrl("facebook", "https://m.facebook.com/mei")).toBe("https://m.facebook.com/mei");
  });

  it("never produces anything but web links", () => {
    expect(socialUrl("website", "javascript:alert(1)")).toBeNull();
    expect(socialUrl("instagram", "javascript:alert(1)")).toBeNull();
    expect(socialUrl("instagram", "mei tan")).toBeNull();
    expect(socialUrl("website", "meitan.com")).toBe("https://meitan.com/");
  });
});

describe("socialEntries", () => {
  it("lists filled-in platforms in a fixed order", () => {
    expect(socialEntries({ instagram: "a", whatsapp: "+62 1", linkedin: " " })).toEqual([
      ["whatsapp", "+62 1"],
      ["instagram", "a"],
    ]);
    expect(socialEntries(null)).toEqual([]);
  });
});

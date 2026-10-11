import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX, NOTE_MAX } from "../src/shared/limits";
import { parseApplication } from "../src/worker/validate";

const valid = { displayName: "Sam", note: "Friend of Alex", turnstileToken: "token-123" };

function parse(overrides: Record<string, unknown>) {
  return parseApplication({ ...valid, ...overrides });
}

describe("parseApplication", () => {
  it("accepts a valid application", () => {
    expect(parseApplication(valid)).toEqual({ ok: true, value: valid });
  });

  it("trims the name and note, and treats a missing note as empty", () => {
    const result = parseApplication({ displayName: "  Sam  ", turnstileToken: "t" });
    expect(result).toEqual({ ok: true, value: { displayName: "Sam", note: "", turnstileToken: "t" } });
    const noted = parse({ note: "  hello  " });
    expect(noted.ok && noted.value.note).toBe("hello");
  });

  it("rejects bodies that are not objects", () => {
    for (const raw of [null, "text", 5, [], undefined]) {
      expect(parseApplication(raw).ok).toBe(false);
    }
  });

  it("rejects a missing, blank, or non-string name", () => {
    expect(parse({ displayName: "" }).ok).toBe(false);
    expect(parse({ displayName: "   " }).ok).toBe(false);
    expect(parse({ displayName: 5 }).ok).toBe(false);
    expect(parseApplication({ turnstileToken: "t" }).ok).toBe(false);
  });

  it("counts characters as people see them, not UTF-16 units", () => {
    expect(parse({ displayName: "😀".repeat(DISPLAY_NAME_MAX) }).ok).toBe(true);
    expect(parse({ displayName: "😀".repeat(DISPLAY_NAME_MAX + 1) }).ok).toBe(false);
  });

  it("enforces the name and note length limits", () => {
    expect(parse({ displayName: "a".repeat(DISPLAY_NAME_MAX) }).ok).toBe(true);
    expect(parse({ displayName: "a".repeat(DISPLAY_NAME_MAX + 1) }).ok).toBe(false);
    expect(parse({ note: "a".repeat(NOTE_MAX) }).ok).toBe(true);
    expect(parse({ note: "a".repeat(NOTE_MAX + 1) }).ok).toBe(false);
  });

  it("rejects control characters in the name, including newlines", () => {
    expect(parse({ displayName: "Sa\nm" }).ok).toBe(false);
    expect(parse({ displayName: "Sa\u0000m" }).ok).toBe(false);
  });

  it("allows newlines in the note but no other control characters", () => {
    const ok = parse({ note: "line one\r\nline two" });
    expect(ok.ok && ok.value.note).toBe("line one\nline two");
    expect(parse({ note: "bad\u0007bell" }).ok).toBe(false);
  });

  it("rejects text-direction tricks in the name and note", () => {
    expect(parse({ displayName: "Sam\u202Egnp" }).ok).toBe(false);
    expect(parse({ note: "hidden \u2066text" }).ok).toBe(false);
  });

  it("rejects a non-string note", () => {
    expect(parse({ note: 5 }).ok).toBe(false);
  });

  it("requires a reasonable verification token", () => {
    expect(parse({ turnstileToken: "" }).ok).toBe(false);
    expect(parse({ turnstileToken: 5 }).ok).toBe(false);
    expect(parseApplication({ displayName: "Sam" }).ok).toBe(false);
    expect(parse({ turnstileToken: "a".repeat(2049) }).ok).toBe(false);
  });
});

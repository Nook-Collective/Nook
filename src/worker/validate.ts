import { DISPLAY_NAME_MAX, NOTE_MAX } from "../shared/limits";

export interface ApplicationInput {
  displayName: string;
  note: string;
  turnstileToken: string;
}

export type ParseResult = { ok: true; value: ApplicationInput } | { ok: false; error: string };

const MAX_TOKEN_CHARS = 2048;

// Control characters. A note may contain newlines, a name may not.
const CONTROL_ANY = /[\u0000-\u001F\u007F-\u009F]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
// Characters that flip or hide text direction. They can make text look like
// something else when an admin reads it.
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

function charCount(text: string): number {
  return [...text].length;
}

function fail(error: string): ParseResult {
  return { ok: false, error };
}

// Checks everything we accept from an applicant. Messages are safe to show them.
export function parseApplication(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("Invalid request.");
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.displayName !== "string") return fail("Enter a name.");
  const displayName = body.displayName.trim();
  if (displayName.length === 0) return fail("Enter a name.");
  if (charCount(displayName) > DISPLAY_NAME_MAX) {
    return fail(`Name must be at most ${DISPLAY_NAME_MAX} characters.`);
  }
  if (CONTROL_ANY.test(displayName) || BIDI_CONTROLS.test(displayName)) {
    return fail("Name contains characters that are not allowed.");
  }

  let note = "";
  if (body.note !== undefined) {
    if (typeof body.note !== "string") return fail("Invalid note.");
    note = body.note.replace(/\r\n/g, "\n").trim();
    if (charCount(note) > NOTE_MAX) return fail(`Note must be at most ${NOTE_MAX} characters.`);
    if (CONTROL_EXCEPT_NEWLINE.test(note) || BIDI_CONTROLS.test(note)) {
      return fail("Note contains characters that are not allowed.");
    }
  }

  if (typeof body.turnstileToken !== "string" || body.turnstileToken.length === 0) {
    return fail("Complete the verification check.");
  }
  if (body.turnstileToken.length > MAX_TOKEN_CHARS) return fail("Invalid verification.");

  return { ok: true, value: { displayName, note, turnstileToken: body.turnstileToken } };
}

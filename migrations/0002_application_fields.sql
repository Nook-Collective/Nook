-- What an applicant tells us. Both are typed by the applicant and are NOT verified.
-- Existing rows (such as a bootstrapped admin) get empty strings.
ALTER TABLE members ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN note TEXT NOT NULL DEFAULT '';

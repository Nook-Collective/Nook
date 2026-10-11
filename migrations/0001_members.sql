-- One row per person who has applied to Nook.
-- user_id is the Supabase Auth user ID (the "sub" claim in their access token).
-- A signed-in person with no row here has not applied yet.
CREATE TABLE members (
  user_id    TEXT PRIMARY KEY,
  status     TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
);

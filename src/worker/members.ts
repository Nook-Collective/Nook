import type { MemberRole, MemberStatus } from "../shared/types";

export interface Member {
  status: MemberStatus;
  role: MemberRole;
}

export interface NewApplication {
  displayName: string;
  note: string;
}

// Every database query uses bound parameters (?1, ?2, ...), never string building.
export async function getMember(db: D1Database, userId: string): Promise<Member | null> {
  return db
    .prepare("SELECT status, role FROM members WHERE user_id = ?1")
    .bind(userId)
    .first<Member>();
}

// Adds a pending application in ONE statement, so two requests at once cannot
// both slip past the checks. Nothing is inserted if this person already has a
// row, or if maxPending applications are already waiting. Returns true if a
// row was added.
export async function createApplication(
  db: D1Database,
  userId: string,
  application: NewApplication,
  maxPending: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO members (user_id, status, role, display_name, note)
       SELECT ?1, 'pending', 'member', ?2, ?3
       WHERE (SELECT COUNT(*) FROM members WHERE status = 'pending') < ?4
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .bind(userId, application.displayName, application.note, maxPending)
    .run();
  return result.meta.changes === 1;
}

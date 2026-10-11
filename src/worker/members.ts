import type { MemberRole, MemberStatus } from "../shared/types";

export interface Member {
  status: MemberStatus;
  role: MemberRole;
}

// Every database query uses bound parameters (?1), never string building.
export async function getMember(db: D1Database, userId: string): Promise<Member | null> {
  return db
    .prepare("SELECT status, role FROM members WHERE user_id = ?1")
    .bind(userId)
    .first<Member>();
}

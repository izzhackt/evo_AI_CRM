/**
 * What the new interface needs, stated as its own contract.
 *
 * The UI binds to this and to nothing else. Everything about where the data
 * lives -- the current canonical PostgreSQL repository, or Supabase once the
 * platform migration lands -- stays behind `loadWorkQueue` in the adapter next
 * to this file. A storage change should touch that one function and no screen.
 *
 * Why the queue is organised by state rather than by date: every `due_at` and
 * `next_action_at` column in the canonical schema is nullable, and the sales
 * contract ships an explicit `unscheduled` filter. Undated work is a designed
 * condition, not missing data, so a home screen built on deadlines is
 * guaranteed to hide real work. What the model does state reliably is that a
 * record has reached a point where a person must act -- `handoff_ready` is
 * exactly that, and the repository gates the handoff on it.
 */

import type { FixedRole } from "@/lib/fixed-role-policy";

/** Why this is in front of someone. One reason, never a list. */
export type WorkReason =
  | "awaiting_reply"        // an inbound message nobody has answered
  | "decision_required"     // the record is in a state that needs a human call
  | "assigned_open"         // assigned to this role and not finished
  | "blocked"               // cannot progress until something is cleared
  | "overdue"               // a date exists and has passed
  | "due_today";

/** What the reader is being asked to act on. */
export type WorkSubject =
  | "lead"
  | "student_case"
  | "task"
  | "application"
  | "visa_milestone"
  | "conversation";

export type WorkItem = Readonly<{
  /** Stable across reloads; the canonical id of the underlying record. */
  id: string;
  subject: WorkSubject;
  reason: WorkReason;
  /** The person this concerns, by name. The identifier is not the headline. */
  personName: string | null;
  /** One line naming the actual next move, in the product's own language. */
  nextAction: string | null;
  /** Present only when the record genuinely carries one. */
  dueAt: string | null;
  /** The role that owns it. The queue never shows another role's work. */
  ownerRole: FixedRole;
  /** Where acting on it happens. */
  href: string;
  /** For the caller to render provenance without a second query. */
  canonicalId: string;
}>;

export type WorkQueue = Readonly<{
  role: FixedRole;
  items: readonly WorkItem[];
  /**
   * Work the queue deliberately does not show, counted rather than hidden:
   * a queue that silently drops rows is worse than a long one.
   */
  excluded: Readonly<{ reason: string; count: number }>[];
}>;

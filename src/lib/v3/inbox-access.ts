import { isStaffPreview, staffCan } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";

/**
 * Presentation decisions of the WhatsApp page that depend only on the actor.
 * The database stays the authority: which conversations a member sees and
 * may answer is decided by the scoped evaluator (migration 261 opens the
 * sales queue to every holder of `communication.read.full` /
 * `communication.manual.send`); nothing here grants or widens anything.
 */

/**
 * Queue filter of the Admin's role preview. «Продажи» previews the sales queue
 * only. Since 06.10.2026 («нет, все могут») the admissions role sees the sales
 * WhatsApp as well as its own handed-off chats, so its preview — like the
 * Admin's own view — has no queue filter.
 */
export function inboxPresentationQueue(
  actor: Pick<ActivePlatformActor, "presentationRole">,
): "sales" | undefined {
  return actor.presentationRole === "sales" ? "sales" : undefined;
}

/**
 * Whether the composer is offered at all (06.10.2026, the chat replaces the
 * «Ответ и отправка» block). A role preview never sends — the server action
 * refuses it too — and a member without `communication.manual.send` reads
 * only. The chat's own facts (a customer message, the session, open) are
 * decided by the page from the read model.
 */
export function inboxReplyActor(
  actor: ActivePlatformActor,
): "allowed" | "preview" | "no_permission" {
  if (isStaffPreview(actor)) return "preview";
  return staffCan(actor, "messaging.send") ? "allowed" : "no_permission";
}

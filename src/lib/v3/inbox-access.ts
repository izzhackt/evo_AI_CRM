import { staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor, PlatformActor } from "../platform-auth.ts";

/**
 * Two presentation decisions of the WhatsApp page that depend only on the
 * actor. The database stays the authority: which conversations a member sees
 * and may answer is decided by the scoped evaluator (migration 261 opens the
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
 * The Gemini proposal readers need `ai.draft.review` besides the right to read
 * the conversation (migrations 091/096). A role that may read and answer
 * WhatsApp without AI drafts must still open the transcript, so the page asks
 * for the AI block only when the actor holds that key (the Admin always does).
 */
export function inboxReadsGeminiDrafts(actor: PlatformActor): boolean {
  return staffHasPermission(actor, "ai.draft.review");
}

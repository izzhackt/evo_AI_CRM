import "server-only";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { getPlatformStudentCaseView, listPlatformStudentCases, type PlatformAdmissionsCursor } from "@/lib/platform-admissions";
import { getPlatformCaseDocumentWorkspace } from "@/lib/platform-private-documents";
import { readCaseChatPage } from "@/lib/v3/case-chat-source";
import { readProfileActivity, parseProfileActivityCursor } from "@/lib/v3/profile-activity-source";
import { KNOWLEDGE_UUID } from "@/lib/knowledge-library-contract";
import { KnowledgeError, requireKnowledgeAdmin } from "@/lib/v3/knowledge-library-source";

export async function readKnowledgeDossiers(actor: ActivePlatformActor, url: URL) {
  requireKnowledgeAdmin(actor);
  let cursor: PlatformAdmissionsCursor | null = null;
  if (url.searchParams.has("afterId")) {
    const at = url.searchParams.get("afterAt") ?? ""; const id = url.searchParams.get("afterId") ?? "";
    if (!KNOWLEDGE_UUID.test(id) || !Number.isFinite(Date.parse(at))) throw new KnowledgeError("knowledge_invalid", 400);
    cursor = { sortAt: at, id };
  }
  const page = await listPlatformStudentCases(actor, { cursor, pageSize: 100, query: url.searchParams.get("search") ?? undefined });
  if (page.rows.some((row) => row.access !== "full")) throw new KnowledgeError("knowledge_forbidden", 403);
  return { items: page.rows.map((row) => row.studentCase), hasMore: page.hasNext, nextCursor: page.nextCursor };
}
export async function readKnowledgeDossier(actor: ActivePlatformActor, id: string, section: string | undefined, url: URL) {
  requireKnowledgeAdmin(actor);
  if (!KNOWLEDGE_UUID.test(id)) throw new KnowledgeError("knowledge_not_found", 404);
  const view = await getPlatformStudentCaseView(actor, id);
  if (!view || view.access !== "full") throw new KnowledgeError("knowledge_not_found", 404);
  if (section === "documents") return getPlatformCaseDocumentWorkspace(actor, id);
  if (section === "chat") return readCaseChatPage(actor, id, url.searchParams.has("before") ? "before" : "latest", url.searchParams.get("before") ?? undefined);
  if (section === "history") {
    const at = url.searchParams.get("beforeAt"); const beforeId = url.searchParams.get("beforeId");
    const cursor = at && beforeId ? parseProfileActivityCursor(at, beforeId) : null;
    if ((at || beforeId) && !cursor) throw new KnowledgeError("knowledge_invalid", 400);
    return readProfileActivity(actor, id, cursor);
  }
  if (section) throw new KnowledgeError("knowledge_not_found", 404);
  return view.studentCase;
}

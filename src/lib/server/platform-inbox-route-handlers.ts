import "server-only";

import { staffCan, staffCanAccessRoute } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  parsePlatformConversationCursor,
  parsePlatformRouteUuid,
  type PlatformConversationCursor,
} from "../platform-communications.ts";
import type { V3InboxMediaAttachmentContext } from "../v3/inbox-media.ts";
import type { InboxChatMessage } from "../v3/whatsapp-chat.ts";

/**
 * Two read-only GET routes of «Продажи → WhatsApp» (06.10.2026):
 *  - `/api/v3/inbox/pulse` — signatures of the list's newest page and of the
 *    open chat, so the page refreshes itself without a manual reload. The
 *    answer carries no text, name or phone; only ids, times and states are
 *    hashed into it.
 *  - `/api/v3/inbox/conversations/[id]/messages` — one older page of the
 *    chat for «Показать ранее», with the «В дело студента» context of that
 *    page's attachments (the same reader and role gate as the page).
 * Both answer `no-store`, refuse an anonymous or keyless caller and decide
 * nothing themselves: the authenticated database readers do.
 */
const HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

type Authorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "unavailable"; actor: null }>;

export type PlatformInboxRouteDependencies = Readonly<{
  authorize(): Promise<Authorization>;
  readPulse(
    actor: ActivePlatformActor,
    options: Readonly<{ conversationId: string | null; query: string | null; waitingOnly: boolean; list: boolean }>,
  ): Promise<Readonly<{ list: string | null; chat: string | null }> | null>;
  readOlder(
    actor: ActivePlatformActor,
    conversationId: string,
    cursor: PlatformConversationCursor,
  ): Promise<Readonly<{
    messages: readonly InboxChatMessage[];
    hasOlder: boolean;
    attachmentContext: V3InboxMediaAttachmentContext | null;
  }> | null>;
}>;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: HEADERS });
}

function refusal(status: Exclude<Authorization["status"], "authorized">): Response {
  if (status === "anonymous") return json(401, { error: "authentication_required" });
  if (status === "forbidden") return json(403, { error: "forbidden" });
  return json(503, { error: "unavailable" });
}

async function defaultAuthorize(): Promise<Authorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  if (!staffCan(result.actor, "messaging.read") || !staffCanAccessRoute(result.actor, "/v3/inbox")) {
    return { status: "forbidden", actor: null };
  }
  return { status: "authorized", actor: result.actor };
}

const defaultDependencies: PlatformInboxRouteDependencies = {
  authorize: defaultAuthorize,
  readPulse: async (actor, options) => (await import("../v3/inbox-source.ts")).readInboxPulse(actor, options),
  readOlder: async (actor, id, cursor) => (await import("../v3/inbox-source.ts")).readInboxOlderMessages(actor, id, cursor),
};

/** Exactly the allowed keys, each at most once; anything else is a bad request. */
function exactParams(url: URL, allowed: readonly string[]): URLSearchParams | null {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !allowed.includes(key)) || new Set(keys).size !== keys.length) return null;
  return url.searchParams;
}

export function createPlatformInboxPulseHandler(
  dependencies: PlatformInboxRouteDependencies = defaultDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const params = exactParams(new URL(request.url), ["conversation", "list", "q", "waiting"]);
      if (params === null) return json(400, { error: "invalid_request" });
      const rawConversation = params.get("conversation");
      const conversationId = rawConversation === null ? null : parsePlatformRouteUuid(rawConversation);
      const list = params.get("list");
      const waiting = params.get("waiting");
      const query = params.get("q")?.trim() ?? null;
      if (
        (rawConversation !== null && conversationId === null)
        || (list !== null && list !== "1")
        || (waiting !== null && waiting !== "1")
        || (query !== null && query.length > 200)
        || (conversationId === null && list === null)
      ) {
        return json(400, { error: "invalid_request" });
      }
      const pulse = await dependencies.readPulse(authorization.actor, {
        conversationId,
        query: query || null,
        waitingOnly: waiting === "1",
        list: list === "1",
      });
      if (pulse === null) return json(404, { error: "not_found" });
      return json(200, { list: pulse.list, chat: pulse.chat });
    } catch {
      // A chat the caller may no longer read is indistinguishable from a
      // failure: the browser stops polling after a few and says so.
      return json(503, { error: "unavailable" });
    }
  };
}

type MessagesRouteContext = Readonly<{
  params: Promise<Readonly<{ conversationId: string }>>;
}>;

export function createPlatformInboxOlderMessagesHandler(
  dependencies: PlatformInboxRouteDependencies = defaultDependencies,
) {
  return async function GET(request: Request, context: MessagesRouteContext): Promise<Response> {
    try {
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const conversationId = parsePlatformRouteUuid((await context.params).conversationId);
      const params = exactParams(new URL(request.url), ["before_at", "before_id"]);
      const cursor = params ? parsePlatformConversationCursor(params.get("before_at"), params.get("before_id")) : null;
      if (conversationId === null || cursor === null) return json(400, { error: "invalid_request" });
      const page = await dependencies.readOlder(authorization.actor, conversationId, cursor);
      if (page === null) return json(404, { error: "not_found" });
      return json(200, { messages: page.messages, hasOlder: page.hasOlder, attachmentContext: page.attachmentContext });
    } catch {
      return json(503, { error: "unavailable" });
    }
  };
}

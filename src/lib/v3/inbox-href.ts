export type V3InboxHrefCursor = Readonly<{
  sortAt: string;
  id: string;
  /** «Неотвеченные»: the row of the cursor awaits our answer (migration 279). */
  waiting?: boolean;
}>;

/**
 * «Сортировка» of the WhatsApp list (owner request 08.10.2026): «Сначала
 * новые» — the default, with no URL parameter, so opening the section always
 * starts there; «Неотвеченные» — `sort=unanswered`.
 */
export type V3InboxSort = "newest" | "unanswered";

export type V3InboxHrefFilters = Readonly<{
  query: string | null;
  sort: V3InboxSort;
}>;

export function buildV3InboxHref({
  conversationId,
  queueCursor,
  messageCursor,
  filters,
}: Readonly<{
  conversationId?: string;
  queueCursor?: V3InboxHrefCursor | null;
  messageCursor?: V3InboxHrefCursor | null;
  filters: V3InboxHrefFilters;
}>): string {
  const query = new URLSearchParams();
  if (filters.query) query.set("q", filters.query);
  if (filters.sort === "unanswered") query.set("sort", "unanswered");
  if (queueCursor) {
    query.set("before_at", queueCursor.sortAt);
    query.set("before_id", queueCursor.id);
    if (queueCursor.waiting !== undefined) {
      query.set("before_waiting", queueCursor.waiting ? "1" : "0");
    }
  }
  if (conversationId) query.set("conversation", conversationId);
  if (messageCursor) {
    query.set("messages_before_at", messageCursor.sortAt);
    query.set("messages_before_id", messageCursor.id);
  }

  const serialized = query.toString();
  return serialized ? `/v3/inbox?${serialized}` : "/v3/inbox";
}

export type V3InboxHrefCursor = Readonly<{
  sortAt: string;
  id: string;
}>;

export type V3InboxHrefFilters = Readonly<{
  query: string | null;
  waitingOnly: boolean;
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
  if (filters.waitingOnly) query.set("waiting", "1");
  if (queueCursor) {
    query.set("before_at", queueCursor.sortAt);
    query.set("before_id", queueCursor.id);
  }
  if (conversationId) query.set("conversation", conversationId);
  if (messageCursor) {
    query.set("messages_before_at", messageCursor.sortAt);
    query.set("messages_before_id", messageCursor.id);
  }

  const serialized = query.toString();
  return serialized ? `/v3/inbox?${serialized}` : "/v3/inbox";
}

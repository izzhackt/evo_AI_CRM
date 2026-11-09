// Синтетические строки «Входящих» (только выдуманные данные).
export const MSG_A = "a0000000-0000-4000-8000-000000000001";
export const MSG_B = "a0000000-0000-4000-8000-000000000002";
export const MSG_C = "a0000000-0000-4000-8000-000000000003";

export const chatMessage = (id: string, sequenceId: string, mine: boolean, body: string, createdAt = "2026-09-07T08:00:00+00:00") => ({
  id,
  sequenceId,
  mine,
  authorName: mine ? "Тест Студентов" : "Команда EVO",
  body,
  createdAt,
  attachmentKind: null,
  attachmentLabel: null,
  quotedBodyPreview: null,
});

/** Страница, как её отдаёт RPC: новые первыми. */
export const chatPage = (messages: ReturnType<typeof chatMessage>[], extra: Partial<{ cursor: string; hasMore: boolean; awaitState: string }> = {}) => ({
  messages,
  cursor: messages.length ? messages[messages.length - 1]!.sequenceId : "0",
  hasMore: false,
  awaitState: "none",
  ...extra,
});

export const POST_RECEIPT = (requestId: string, sequenceId = "9") => ({
  requestId,
  messageId: "c0000000-0000-4000-8000-0000000000aa",
  sequenceId,
  createdAt: "2026-09-07T09:00:00+00:00",
  mode: "portal_post",
  studentCaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
});

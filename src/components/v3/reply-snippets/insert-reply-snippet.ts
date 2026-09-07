export type ReplySnippetInsertion = Readonly<{
  value: string;
  selectionStart: number;
  selectionEnd: number;
}>;

export type ReplySnippetInsertionAttempt = ReplySnippetInsertion &
  Readonly<{ accepted: boolean }>;

export const REPLY_MESSAGE_MAX_CODE_POINTS = 3_000;

export function isReplyMessageWithinCodePointLimit(
  value: string,
  maxCodePoints = REPLY_MESSAGE_MAX_CODE_POINTS,
): boolean {
  return Array.from(value).length <= maxCodePoints;
}

function boundedOffset(value: string, offset: number | null | undefined): number {
  if (!Number.isInteger(offset)) return value.length;
  return Math.min(Math.max(offset ?? value.length, 0), value.length);
}

export function insertReplySnippet(
  value: string,
  body: string,
  selectionStart?: number | null,
  selectionEnd?: number | null,
): ReplySnippetInsertion {
  const start = boundedOffset(value, selectionStart);
  const end = Math.max(start, boundedOffset(value, selectionEnd ?? start));
  const nextValue = `${value.slice(0, start)}${body}${value.slice(end)}`;
  const caret = start + body.length;

  return {
    value: nextValue,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/**
 * Applies the same UTF-16 selection offsets exposed by a textarea while
 * enforcing the provider contract in Unicode code points.
 */
export function insertReplySnippetWithinCodePointLimit(
  value: string,
  body: string,
  selectionStart?: number | null,
  selectionEnd?: number | null,
  maxCodePoints = REPLY_MESSAGE_MAX_CODE_POINTS,
): ReplySnippetInsertionAttempt {
  const start = boundedOffset(value, selectionStart);
  const end = Math.max(start, boundedOffset(value, selectionEnd ?? start));
  const insertion = insertReplySnippet(value, body, start, end);

  if (!isReplyMessageWithinCodePointLimit(insertion.value, maxCodePoints)) {
    return {
      accepted: false,
      value,
      selectionStart: start,
      selectionEnd: end,
    };
  }

  return { accepted: true, ...insertion };
}

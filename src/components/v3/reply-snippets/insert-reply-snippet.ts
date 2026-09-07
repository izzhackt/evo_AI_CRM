export type ReplySnippetInsertion = Readonly<{
  value: string;
  selectionStart: number;
  selectionEnd: number;
}>;

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

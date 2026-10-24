"use client";

import { useState, type RefObject } from "react";

import { insertReplySnippetWithinCodePointLimit, REPLY_MESSAGE_MAX_CODE_POINTS } from "./insert-reply-snippet";

export type ReplySnippetPickerItem = Readonly<{
  replySnippetId: string;
  title: string;
  body: string;
}>;

export type ReplySnippetPickerProps = Readonly<{
  snippets: readonly ReplySnippetPickerItem[];
  messageText: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onMessageTextChange: (value: string) => void;
  disabled?: boolean;
  /**
   * Предел итогового текста в знаках Unicode. По умолчанию — предел
   * отправки WhatsApp (3000); переписка по делу передаёт свой (8000, Э5).
   */
  maxCodePoints?: number;
}>;

/**
 * Окно шаблонов в поле ответа: список названий с началом текста, нажатие
 * вставляет шаблон в текст (в место курсора) и ничего не отправляет. Окно
 * закрывает вызвавший его экран в `onMessageTextChange`.
 */
export function ReplySnippetPicker({
  snippets,
  messageText,
  textareaRef,
  onMessageTextChange,
  disabled = false,
  maxCodePoints = REPLY_MESSAGE_MAX_CODE_POINTS,
}: ReplySnippetPickerProps) {
  const [rejectedMessageText, setRejectedMessageText] = useState<string | null>(
    null,
  );

  const insert = (snippet: ReplySnippetPickerItem) => {
    const textarea = textareaRef.current;
    const insertion = insertReplySnippetWithinCodePointLimit(
      messageText,
      snippet.body,
      textarea?.selectionStart,
      textarea?.selectionEnd,
      maxCodePoints,
    );
    if (!insertion.accepted) {
      setRejectedMessageText(messageText);
      return;
    }

    setRejectedMessageText(null);
    onMessageTextChange(insertion.value);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(
        insertion.selectionStart,
        insertion.selectionEnd,
      );
    });
  };

  if (snippets.length === 0) {
    return <p className="p-2 t-body-compact text-fg-3">Доступных шаблонов ответа нет.</p>;
  }

  return (
    <div data-testid="v3-reply-snippet-picker">
      <ul className="max-h-[min(24rem,calc(100dvh-2rem))] overflow-y-auto">
        {snippets.map((snippet) => (
          <li key={snippet.replySnippetId}>
            <button
              type="button"
              onClick={() => insert(snippet)}
              disabled={disabled}
              className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-nav px-3 py-2 text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:text-fg-3"
            >
              <span className="t-item text-fg">{snippet.title}</span>
              <span className="line-clamp-2 break-words t-meta text-fg-2">{snippet.body}</span>
            </button>
          </li>
        ))}
      </ul>
      {rejectedMessageText === messageText ? (
        <p role="alert" className="px-3 py-2 t-body-compact text-danger">
          Шаблон не вставлен: финальный текст не может превышать {maxCodePoints} символов.
        </p>
      ) : null}
    </div>
  );
}

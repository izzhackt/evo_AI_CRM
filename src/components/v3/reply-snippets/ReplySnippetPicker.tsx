"use client";

import { useState, type RefObject } from "react";

import { btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { PlatformReplySnippet } from "@/lib/platform-reply-snippets";

import { insertReplySnippet } from "./insert-reply-snippet";

export type ReplySnippetPickerProps = Readonly<{
  snippets: readonly PlatformReplySnippet[];
  messageText: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onMessageTextChange: (value: string) => void;
  disabled?: boolean;
}>;

export function ReplySnippetPicker({
  snippets,
  messageText,
  textareaRef,
  onMessageTextChange,
  disabled = false,
}: ReplySnippetPickerProps) {
  const [selectedId, setSelectedId] = useState(snippets[0]?.replySnippetId ?? "");
  const activeSelectedId = snippets.some(
      (snippet) => snippet.replySnippetId === selectedId,
    )
    ? selectedId
    : (snippets[0]?.replySnippetId ?? "");

  const insertSelected = () => {
    const snippet = snippets.find((item) => item.replySnippetId === activeSelectedId);
    if (!snippet) return;

    const textarea = textareaRef.current;
    const insertion = insertReplySnippet(
      messageText,
      snippet.body,
      textarea?.selectionStart,
      textarea?.selectionEnd,
    );
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
    return <p className="text-sm text-fg-3">Доступных шаблонов ответа нет.</p>;
  }

  return (
    <div
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      data-testid="v3-reply-snippet-picker"
    >
      <label>
        <span className={labelCls}>Шаблон ответа</span>
        <select
          className={inputCls}
          value={activeSelectedId}
          onChange={(event) => setSelectedId(event.currentTarget.value)}
          disabled={disabled}
        >
          {snippets.map((snippet) => (
            <option key={snippet.replySnippetId} value={snippet.replySnippetId}>
              {snippet.title}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={btnGhostCls}
        onClick={insertSelected}
        disabled={disabled || activeSelectedId === ""}
      >
        Вставить в текст
      </button>
    </div>
  );
}

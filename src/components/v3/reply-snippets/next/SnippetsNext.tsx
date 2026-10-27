"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { DataTable, DetailSheet, EmptyState, StatusBadge, type DataTableColumn } from "@/components/kit";
import { sheetEscape } from "@/components/v3/panel/sheet-escape";

import {
  AUDIENCE_LABELS, type KnowledgeReplySnippetItem, type KnowledgeReplySnippetSectionProps,
} from "../KnowledgeReplySnippetSection";
import { createReplySnippetFormKey, replySnippetRowFormKey } from "../reply-snippet-form-keys";
import { SnippetCreateSheet } from "./SnippetCreateSheet";
import { SnippetSheetBody } from "./SnippetSheetBody";
import { replySnippetIdFromHash } from "./snippet-hash";

const columns = (canManage: boolean): DataTableColumn<KnowledgeReplySnippetItem>[] => [
  {
    id: "title", accessorFn: (item) => item.snippet.title, header: "Название", meta: { mobile: "title" }, enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block font-medium text-fg [overflow-wrap:anywhere]">{row.original.snippet.title}</span>
        <span className="block max-w-prose truncate t-meta text-fg-3">{row.original.snippet.body}</span>
      </span>
    ),
  },
  { id: "audience", accessorFn: (item) => AUDIENCE_LABELS[item.snippet.audience], header: "Кому доступен", cell: ({ row }) => <StatusBadge label={AUDIENCE_LABELS[row.original.snippet.audience]} /> },
  ...(canManage ? [{ id: "author", accessorFn: (item: KnowledgeReplySnippetItem) => item.snippet.createdByDisplayName, header: "Автор", meta: { wide: true } } satisfies DataTableColumn<KnowledgeReplySnippetItem>] : []),
];

/**
 * «Шаблоны ответов» в новом виде: таблица (название и начало текста, кому доступен, автор), строка открывает панель с текстом
 * и — у кого есть право — формами «Сохранить» и «Архивировать» (те же действия, версия и request_id); «Новый шаблон» — единственная красная
 * кнопка. Данные и права приходят с сервера теми же, что у `KnowledgeReplySnippetSection`.
 */
export function SnippetsNext({ items, canManage, availableAudiences, createRequestId }: KnowledgeReplySnippetSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((item) => item.snippet.replySnippetId === openId) ?? null;
  // Ссылка из поиска (`#reply-snippet-<id>`) открывает панель этого шаблона и при загрузке, и при смене якоря — даже со второй страницы таблицы.
  const openFromAddress = useEffectEvent(() => {
    const id = replySnippetIdFromHash(window.location.hash);
    if (id && items.some((item) => item.snippet.replySnippetId === id)) setOpenId(id);
  });
  useEffect(() => {
    const onHash = () => openFromAddress();
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <div className="grid gap-3" data-testid="v3-knowledge-reply-snippets">
      <DataTable
        label="Шаблоны ответов"
        data={items}
        columns={columns(canManage)}
        getRowId={(item) => item.snippet.replySnippetId}
        getRowLabel={(item) => item.snippet.title}
        onRowClick={(item) => setOpenId(item.snippet.replySnippetId)}
        searchPlaceholder="Найти шаблон"
        columnMenu={false}
        toolbar={canManage ? <SnippetCreateSheet key={createReplySnippetFormKey(createRequestId)} requestId={createRequestId} audiences={availableAudiences} /> : undefined}
        empty={<EmptyState title="Шаблонов пока нет" />}
      />
      <DetailSheet
        open={open !== null}
        onOpenChange={(next) => { if (!next) setOpenId(null); }}
        onEscapeKeyDown={sheetEscape}
        title={open?.snippet.title ?? "Шаблон"}
        description={open ? AUDIENCE_LABELS[open.snippet.audience] : undefined}
      >
        {open ? <SnippetSheetBody key={replySnippetRowFormKey(open.snippet.replySnippetId, open.updateRequestId, open.archiveRequestId)} item={open} canManage={canManage} audiences={availableAudiences} /> : null}
      </DetailSheet>
    </div>
  );
}

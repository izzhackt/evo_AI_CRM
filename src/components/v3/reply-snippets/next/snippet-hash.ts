/**
 * Шаблон из адреса: поиск «Материалы CRM» ведёт на `/v3/knowledge?section=snippets#reply-snippet-<id>` (`knowledge-library/search.ts`).
 * Возвращает `<id>` или `null`, если якорь не про шаблон (в том числе с битым %-кодом).
 */
export function replySnippetIdFromHash(hash: string): string | null {
  const match = /^#reply-snippet-(.+)$/u.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

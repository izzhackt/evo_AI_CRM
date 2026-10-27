/** «Управление каталогом» в «Новом виде»: ссылки и слова готовит сервер (адреса с контекстом списка), вид только рисует. */
export type ManageDraftRow = Readonly<{ id: string; name: string; baseVersion: number; href: string }>;

export type ManageIndexProps = Readonly<{
  query: string;
  /** «Сбросить»: что-то выбрано (поиск или страница). */
  resetHref: string | null;
  /** null — чтение черновиков не удалось: об этом сказано, пустой очередью оно не называется. */
  drafts: Readonly<{ rows: readonly ManageDraftRow[]; emptyText: string; firstHref: string | null; nextHref: string | null }> | null;
  batchHref: string;
  groups: readonly Readonly<{ code: string; label: string; items: readonly Readonly<{ key: string; name: string; href: string }>[] }>[];
  groupsEmptyText: string;
}>;

import type { ReactNode } from "react";

import { CARD_BODY, CARD_FRAME, CARD_FRAME_FLAT, CARD_HEADER, CARD_TITLE } from "@/components/kit/card-classes";
import { HelpTip } from "@/components/kit/HelpTip";

export type DocumentsNextGroup = Readonly<{ title: string; count: number; rows: ReactNode }>;

/**
 * Вкладка «Документы» в «Новом виде»: раскладка карточками набора из кусков, которые собирает `ProfileDocumentsClient`
 * (состояние загрузок, формы «+ Документ», строки `DocumentRow` остаются у него: те же команды, те же ключи запросов).
 * Первая карточка - «Чек-лист»: «N из M принято», фильтр по состоянию, кнопка «Документ» и формы добавления; формат загрузки -
 * за «?». Дальше по карточке на группу (заголовок и число пунктов), под ними распознавание и история удалённых пунктов -
 * раскрытиями в том же виде. Без этого файла у `ProfileDocumentsClient` остаётся прежняя разметка.
 */
export function DocumentsNextLayout({
  progress,
  addToggle,
  uploadHint,
  accessNote,
  addRegion,
  filter,
  movedNote,
  empty,
  groups,
  recognition,
  history,
}: Readonly<{
  progress: ReactNode;
  addToggle: ReactNode;
  uploadHint: string | null;
  accessNote: ReactNode;
  addRegion: ReactNode;
  filter: ReactNode;
  movedNote: ReactNode;
  empty: ReactNode;
  groups: readonly DocumentsNextGroup[];
  recognition: ReactNode;
  history: ReactNode;
}>) {
  return (
    <section aria-labelledby="case-documents-title" className="grid min-w-0 grid-cols-1 gap-4" data-testid="v3-case-documents">
      <h2 id="case-documents-title" className="sr-only">Документы дела</h2>
      <div className={CARD_FRAME} data-testid="v3-documents-checklist">
        <div className={CARD_HEADER}>
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className={CARD_TITLE}>Чек-лист</h3>
            {uploadHint ? <HelpTip label="Пояснение: Чек-лист">{uploadHint}</HelpTip> : null}
          </div>
          {addToggle}
        </div>
        <div className={`${CARD_BODY} grid grid-cols-1 gap-3`}>
          {progress}
          {accessNote}
          {addRegion}
          {filter}
          {movedNote}
          {empty}
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.title} className={CARD_FRAME} data-testid="v3-documents-group">
          <div className={CARD_HEADER}>
            <h3 className={CARD_TITLE}>
              {group.title}
              <span className="ml-2 font-normal tabular-nums text-fg-3">{group.count}</span>
            </h3>
          </div>
          <div className={CARD_BODY}>{group.rows}</div>
        </div>
      ))}
      {/* Распознавание и история удалённых - прежние раскрытия в рамке карточки: свои линии сверху и снизу, верхний отступ и поле у них сняты. */}
      {recognition ? <div className={`${CARD_FRAME_FLAT} px-5 [&>section]:border-t-0 [&>section]:mt-0 [&>section]:pt-0`}>{recognition}</div> : null}
      {history ? <div className={`${CARD_FRAME_FLAT} px-5 [&_details]:border-y-0`}>{history}</div> : null}
    </section>
  );
}

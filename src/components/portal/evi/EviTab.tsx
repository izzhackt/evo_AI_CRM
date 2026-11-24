import { askEviAction } from "@/lib/portal/evi-actions";
import type { PortalStrings } from "@/lib/portal/i18n";

import { EviChat } from "./EviChat";

/**
 * Вкладка «Подбор с Эви». Ученику, отозвавшему согласие на ИИ-помощников, страница её не показывает (страница
 * «Профессий»): согласие спрашивают при регистрации, на рабочих экранах — нет. `online` — на сервере задан ключ Эви
 * (`EVO_EVI_ANTHROPIC_API_KEY`, кладёт владелец): чат отвечает через серверное действие. Ключа нет — чат `offline`:
 * с первого экрана «Эви сейчас недоступен» и «Открыть каталог», поле закрыто.
 */
export function EviTab({ strings, online, owner, stale }: Readonly<{
  strings: PortalStrings<"professions">;
  online: boolean;
  /**
   * Непрозрачная метка ученика для памяти разговора (`eviOwnerKey`). Она же ключ чата: если страница перерисовалась для
   * другого ученика (вход в соседней вкладке), чат начинается заново, а не переписывает прежний разговор на нового.
   */
  owner: string;
  /** «Вышла новая версия» и «Обновить страницу» из словаря оболочки кабинета. */
  stale: Readonly<{ text: string; reload: string }>;
}>) {
  return online ? <EviChat key={owner} strings={strings} ask={askEviAction} owner={owner} stale={stale} /> : <EviChat strings={strings} offline />;
}

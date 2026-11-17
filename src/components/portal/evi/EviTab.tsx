import type { PortalStrings } from "@/lib/portal/i18n";

import { EviChat } from "./EviChat";

/**
 * Вкладка «Подбор с Эви». Ученику, отозвавшему согласие на ИИ-помощников, страница её не показывает (страница
 * «Профессий»): согласие спрашивают при регистрации, на рабочих экранах — нет. Разговор с
 * моделью подключается отдельным шагом (решение владельца 16.11.2026: сначала интерфейс); до этого чат `offline`:
 * с первого экрана «Эви сейчас недоступен» и «Открыть каталог», поле закрыто (17.11.2026). С моделью `offline` → `ask`.
 */
export function EviTab({ strings }: Readonly<{ strings: PortalStrings<"professions"> }>) {
  return <EviChat strings={strings} offline />;
}

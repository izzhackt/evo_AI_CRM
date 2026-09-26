/**
 * Облик, в котором рисуется экран (Э1.3 плана редизайна, 26.09.2026).
 *
 * `"next"` — новый облик: предпросмотр Admin (`readLookPreview`, #1062), тот же,
 * что ставит `data-look="next"` на `.v3-world`. Общие блоки
 * (`src/components/v3/blocks/`) рисуются только в нём; без пропа компонент
 * рисует прежний облик байт в байт. Временное сосуществование до решения
 * владельца (Э1.5, izzhackt/evo_AI_CRM#1061): после него проп удаляется.
 */
export type V3Look = "next";

export function isNextLook(look: V3Look | undefined): look is "next" {
  return look === "next";
}

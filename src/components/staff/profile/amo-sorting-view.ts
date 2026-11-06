/**
 * Вкладка «Документы»: разбор файлов из amoCRM (миграция 333). Чистая логика без React: какие файлы ещё не разобраны,
 * что показывает строка и что берёт «Принять все уверенные». Подсказки приходят из базы уже с учётом согласия студента.
 */
import {
  isAmoUnsortedGroup, suggestionView, type CaseDocumentSuggestions, type DocumentKindKey, type DocumentSuggestion,
} from "../../../lib/document-classification.ts";
import type { ActiveDocumentGroup } from "./document-types.ts";

export type SortingFile = Readonly<{
  slotId: string;
  versionId: string;
  filename: string;
  uploadedAt: string;
  downloadReady: boolean;
  isPdf: boolean;
}>;
export type SortingRow = Readonly<{
  file: SortingFile;
  band: "confident" | "possible" | "unknown";
  kind: DocumentKindKey | null;
  text: string | null;
}>;

/** Неразобранные: пункт группы «Из amoCRM…», файл есть и ждёт проверки. Принятые и возвращённые на исправление сюда не попадают. */
export function amoSortingFiles(groups: readonly ActiveDocumentGroup[]): readonly SortingFile[] {
  const files: SortingFile[] = [];
  for (const group of groups) {
    if (!isAmoUnsortedGroup(group.title)) continue;
    for (const item of group.items) {
      if (item.presence !== "present" || item.status !== "submitted" || item.intentKind !== "custom") continue;
      files.push(Object.freeze({ slotId: item.id, versionId: item.currentVersionId, filename: item.currentFilename,
        uploadedAt: item.currentVersionCreatedAt, downloadReady: item.downloadReady, isPdf: /\.pdf$/i.test(item.currentFilename) }));
    }
  }
  return Object.freeze(files);
}

export function sortingRows(files: readonly SortingFile[], suggestions: CaseDocumentSuggestions | null): readonly SortingRow[] {
  const byVersion = new Map<string, DocumentSuggestion>();
  // Без согласия студента (aiAllowed: false) подсказок нет, даже если база что-то прислала.
  if (suggestions?.aiAllowed) for (const item of suggestions.items) byVersion.set(item.documentVersionId, item);
  return Object.freeze(files.map((file) => {
    const view = suggestionView(byVersion.get(file.versionId) ?? null);
    return Object.freeze({ file, band: view.band, kind: view.kind, text: view.text });
  }));
}

/** «Принять все уверенные»: только полоса «уверенно». «Возможно» и «не определено» остаются на ручной выбор. */
export function confidentRows(rows: readonly SortingRow[]): readonly SortingRow[] {
  return rows.filter((row) => row.band === "confident" && row.kind !== null && row.file.downloadReady);
}

export type SortingMode = "ai" | "manual" | "unavailable";
/** Почему подсказок нет: студент не разрешил ИИ (ручной путь), чтение не удалось, либо ИИ разрешён и просто ещё не запускали. */
export function sortingMode(suggestions: CaseDocumentSuggestions | null): SortingMode {
  if (suggestions === null) return "unavailable";
  return suggestions.aiAllowed ? "ai" : "manual";
}

export function bulkConfirmText(count: number): string {
  const mod10 = count % 10; const mod100 = count % 100;
  const noun = mod10 === 1 && mod100 !== 11 ? "файл" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "файла" : "файлов";
  return `Принять ${count} ${noun} так, как подсказал ИИ? Каждый переедет в свой пункт чек-листа и будет отмечен принятым.`;
}

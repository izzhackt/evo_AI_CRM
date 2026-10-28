import { aiDateTime, type AiDocument } from "@/lib/v3/ai-agent";

/** Слова и разбор строк «Материалов» — те же, что в прежнем виде (`AiAgentViews`): способ загрузки, версии, склонения. */
const KIND_LABEL: Readonly<Record<string, string>> = { knowledge: "страница", text: "текст", docx: "DOCX", xlsx: "XLSX", csv: "CSV", pdf: "PDF", image: "скан" };

export function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const ones = count % 10;
  return `${count.toLocaleString("ru-RU")} ${tens >= 11 && tens <= 14 ? many : ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many}`;
}

/** «День.месяц.год» без времени: время обработки в списке ничего не решает. */
export const documentDay = (iso: string): string => aiDateTime(iso).split(",")[0] ?? "";

/** Откуда материал и что с ним: страница «Базы знаний» не называется «страница», версия — только если не первая. */
export function sourceLine(document: AiDocument): string {
  const kind = document.kind === "knowledge" ? null : KIND_LABEL[document.kind] ?? document.kind;
  const from = document.source === "seed_kb"
    ? `«База знаний»${document.sourceNodeVersion !== null && document.sourceNodeVersion > 1 ? `, версия ${document.sourceNodeVersion}` : ""}`
    : document.source === "lab" ? "Лаборатория" : "загружен";
  return [kind, from, document.editedInLab ? "изменён в Лаборатории" : null].filter(Boolean).join(" · ");
}

export const LIVE = new Set(["ready", "review"]);

/**
 * Новые версии лежат под своей прежней (§7: «старая версия ищется, пока новая не готова»): у прежней строки есть преемник, а сама новая
 * версия отдельной строкой не идёт.
 */
export function groupVersions(items: readonly AiDocument[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const successors = new Map<string, AiDocument>();
  for (const item of items) {
    const previous = item.replacesId ? byId.get(item.replacesId) : undefined;
    if (previous && LIVE.has(previous.status) && !LIVE.has(item.status)) successors.set(previous.id, item);
  }
  const nested = new Set([...successors.values()].map((item) => item.id));
  return { rows: items.filter((item) => !nested.has(item.id)), successors };
}

export type DocumentRow = Readonly<{ document: AiDocument; successor: AiDocument | null }>;

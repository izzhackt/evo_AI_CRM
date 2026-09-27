/**
 * Массовые действия очереди (Э7): выбранные строки идут своей существующей
 * командой по одной — со своей проверкой прав, своей ожидаемой версией и
 * своим ключом запроса. Новой SQL-команды нет, «всё или ничего» нет: итог
 * честно говорит, что сохранено, а что нет и почему. Файл чистый — без React
 * и без запросов; его проверяет unit-тест.
 */

export type BulkItem = Readonly<{ key: string; label: string }>;

export type BulkOutcome = Readonly<{
  key: string;
  label: string;
  status: "saved" | "failed" | "skipped";
  /** Почему не сохранено или не отправлено; null — сохранено. */
  reason: string | null;
}>;

/** Ответ команды одной строки: null — сохранено, строка — причина отказа. */
export type BulkCommand<Item extends BulkItem> = (item: Item) => Promise<string | null>;

export const BULK_UNCONFIRMED = "Сохранение не подтверждено. Повторите.";

/**
 * Строки по одной, по порядку выбора. Сбой одной строки не останавливает
 * остальные; исключение команды — «не подтверждено», а не «сохранено».
 */
export async function runBulk<Item extends BulkItem>(
  items: readonly Item[],
  command: BulkCommand<Item>,
  onProgress: (done: number) => void = () => {},
): Promise<readonly BulkOutcome[]> {
  const outcomes: BulkOutcome[] = [];
  for (const item of items) {
    let reason: string | null;
    try {
      reason = await command(item);
    } catch {
      reason = BULK_UNCONFIRMED;
    }
    outcomes.push({ key: item.key, label: item.label, status: reason === null ? "saved" : "failed", reason });
    onProgress(outcomes.length);
  }
  return outcomes;
}

/** Строки, к которым действие не подходит: не отправляются и названы до отправки. */
export function bulkSkipped(items: readonly BulkItem[], reason: string): readonly BulkOutcome[] {
  return items.map((item) => ({ key: item.key, label: item.label, status: "skipped", reason }));
}

export type BulkSummary = Readonly<{ saved: number; failed: number; skipped: number; total: number }>;

export function bulkSummary(outcomes: readonly BulkOutcome[]): BulkSummary {
  const count = (status: BulkOutcome["status"]) => outcomes.filter((outcome) => outcome.status === status).length;
  return { saved: count("saved"), failed: count("failed"), skipped: count("skipped"), total: outcomes.length };
}

/** Итог словами: «Сохранено 3 из 5. Не сохранено 2.» — число только из ответов команд. */
export function bulkSummaryText(summary: BulkSummary, noun: Readonly<{ one: string; few: string; many: string }>): string {
  const sent = summary.saved + summary.failed;
  const parts = [`Сохранено ${summary.saved} из ${sent}.`];
  if (summary.failed) parts.push(`Не сохранено ${summary.failed}.`);
  if (summary.skipped) parts.push(`Не подошло ${summary.skipped} ${plural(summary.skipped, noun)}.`);
  return parts.join(" ");
}

export function plural(count: number, noun: Readonly<{ one: string; few: string; many: string }>): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return noun.many;
  if (units === 1) return noun.one;
  if (units >= 2 && units <= 4) return noun.few;
  return noun.many;
}

/**
 * После итога выбранными остаются только несохранённые строки — их можно
 * повторить; сохранённые и неподходящие снимаются.
 */
export function keysToKeep(outcomes: readonly BulkOutcome[]): readonly string[] {
  return outcomes.filter((outcome) => outcome.status === "failed").map((outcome) => outcome.key);
}

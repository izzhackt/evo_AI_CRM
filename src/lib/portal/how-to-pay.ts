// Разбор текста «Как оплатить». Текст и QR задаёт администратор одним полем
// (`platform.payment_details_versions`, миграция 358) — здесь нет своих реквизитов.
// Чистый модуль: его берёт и серверная страница, и клиентская карточка.
import type { PaymentDue } from "./payment-center.ts";

export type HowToPayFieldKey = "bank" | "recipient" | "phone";

export type HowToPayField = Readonly<{
  key: HowToPayFieldKey;
  value: string;
  copyValue: string;
}>;

export type HowToPayText = Readonly<{
  /** Хотя бы банк, получатель или телефон узнаны в тексте администратора. */
  structured: boolean;
  fields: readonly HowToPayField[];
  /** Строки, которые не вошли в поля (счёт, назначение). Инструкция «отсканируйте QR» сюда не попадает. */
  rest: string;
  /** Короткое имя банка над QR, например «KICB». Нет короткого имени — подписи нет. */
  brand: string | null;
}>;

export type HowToPayAmount = Readonly<{
  /** Уже отформатированная сумма, как на остальной «Оплате». */
  display: string;
  /** Дата срока по Бишкеку, без слова «до». Нет срока — null. */
  dueOn: string | null;
  /** Число для вставки в поле суммы банковского приложения. */
  copyValue: string;
  /** Срок уже прошёл: вместо «до …» пишем «просрочено». */
  overdue: boolean;
}>;

// Подпись отделена двоеточием или тире с пробелом («Банк - KICB»). Голое «Номер:» не телефон: так пишут и номер карты.
const SEP = String.raw`(?:\s*[:：]|\s+[-–—])\s*(.+)$`;
const FIELD_LABELS: readonly { key: HowToPayFieldKey; pattern: RegExp }[] = [
  { key: "bank", pattern: new RegExp(`^(?:банк|bank)${SEP}`, "iu") },
  { key: "recipient", pattern: new RegExp(`^(?:получатель|алуучу|recipient)${SEP}`, "iu") },
  { key: "phone", pattern: new RegExp(`^(?:телефон|тел\\.?|phone|номер\\s+телефона)${SEP}`, "iu") },
];

/** Строка-подсказка про сканирование. Своих данных в ней нет, QR её заменяет. Строка с двоеточием или цифрами — реквизит, её не прячем. */
function isScanInstruction(line: string): boolean {
  // В строке с цифрами может быть счёт или сумма — её показываем, даже если там же слово «QR».
  if (/[:：]/u.test(line) || /\d/u.test(line)) return false;
  return /(?:отсканир|сканируйте|qr[-\s]?код|сканерле)/iu.test(line);
}

/** «KICB» из «KICB (Kyrgyz …)». Длинная фраза без короткого кода не становится выдуманной маркой. */
export function qrBrandLabel(bank: string | null): string | null {
  if (!bank) return null;
  const token = bank.trim().split(/[\s(（]/u)[0] ?? "";
  return /^[\p{L}][\p{L}\p{N}]{1,15}$/u.test(token) ? token : null;
}

/**
 * Номер для вставки в банковское приложение: остаются «+» и цифры.
 * Пробелы, скобки и дефисы банковское поле номера обычно не принимает, а «+» нужен, чтобы код страны не потерялся.
 * Несколько номеров («… / …», «… или …») — копируется первый: склеенные цифры дали бы несуществующий номер.
 * Не похоже на телефон (меньше 7 или больше 15 цифр) — возвращаем текст как есть.
 */
export function dialablePhone(value: string): string {
  const first = value.split(/[/,;]|\s(?:или|or|же)\s/iu).find((part) => /\d/u.test(part)) ?? value;
  const compact = first.replace(/[^\d+]/gu, "");
  const digits = compact.replace(/\+/gu, "");
  if (digits.length < 7 || digits.length > 15) return value.trim();
  return compact.startsWith("+") ? `+${digits}` : digits;
}

/** Минорные единицы → «1500» или «1500.50», без пробелов и без слова валюты. */
export function amountCopyValue(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return "";
  const whole = Math.trunc(amountMinor / 100);
  const fraction = amountMinor % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

/**
 * Сколько ещё платить по траншу: остаток минус чеки, которые куратор ещё проверяет.
 * Иначе студент видит «оплатите X» рядом с «X на проверке» и может заплатить дважды.
 */
export function amountToPayMinor(due: PaymentDue): number {
  const inReview = due.entries.reduce((sum, entry) => (
    entry.kind === "receipt" && entry.status === "review" && entry.currency === due.currency ? sum + entry.amountMinor : sum
  ), 0);
  return Math.max(0, due.outstandingMinor - inReview);
}

/**
 * Следующий неоплаченный транш: есть что платить (`amountToPayMinor` больше нуля) и самый ранний срок.
 * Без срока — после тех, у кого срок есть. Одинаковый срок — порядок ответа кабинета.
 * Закрытый транш и транш, целиком покрытый чеками на проверке, не показываем.
 */
export function nextUnpaidTranche(dues: readonly PaymentDue[]): PaymentDue | null {
  const open = dues.filter((due) => amountToPayMinor(due) > 0);
  if (open.length === 0) return null;
  return open.reduce((best, due) => {
    if (best.dueAt === due.dueAt) return best;
    if (best.dueAt === null) return due;
    if (due.dueAt === null) return best;
    return due.dueAt < best.dueAt ? due : best;
  });
}

function field(key: HowToPayFieldKey, value: string): HowToPayField {
  const clean = value.trim();
  return { key, value: clean, copyValue: key === "phone" ? dialablePhone(clean) : clean };
}

/**
 * Текст администратора → поля. Узнаём подписи «Банк», «Получатель», «Телефон»
 * (и короткие синонимы). Первая строка без двоеточия становится банком, если рядом есть
 * подпись получателя или телефона, либо если это единственная короткая строка
 * («KICB (Kyrgyz Investment and Credit Bank)»). Чужие подписи («Счёт:») остаются в `rest`.
 * Ничего не узнали — `structured: false`, и карточка показывает текст как абзац.
 */
export function parseHowToPayText(text: string): HowToPayText {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
  const found: Partial<Record<HowToPayFieldKey, string>> = {};
  const unlabeled: string[] = [];
  const rest: string[] = [];
  for (const line of lines) {
    const labeled = FIELD_LABELS.find((item) => item.pattern.test(line));
    if (labeled) {
      const value = labeled.pattern.exec(line)?.[1]?.trim() ?? "";
      if (value.length === 0) rest.push(line);
      else if (found[labeled.key] === undefined) found[labeled.key] = value;
      else rest.push(line);
      continue;
    }
    if (isScanInstruction(line)) continue;
    if (!/[:：]/u.test(line)) unlabeled.push(line);
    else rest.push(line);
  }
  const hasLabeledField = found.bank !== undefined || found.recipient !== undefined || found.phone !== undefined;
  if (
    found.bank === undefined
    && unlabeled.length > 0
    && unlabeled[0].length <= 120
    && (hasLabeledField || (unlabeled.length === 1 && rest.length === 0))
  ) {
    const bankLine = unlabeled.shift();
    if (bankLine) found.bank = bankLine;
  }
  const fields = (["bank", "recipient", "phone"] as const)
    .filter((key) => found[key] !== undefined && found[key] !== "")
    .map((key) => field(key, found[key] ?? ""));
  const leftover = [...unlabeled, ...rest].join("\n");
  if (fields.length === 0) {
    return { structured: false, fields: [], rest: text.trim(), brand: null };
  }
  return {
    structured: true,
    fields,
    rest: leftover,
    brand: qrBrandLabel(found.bank ?? null),
  };
}

/**
 * Запись в буфер. Сначала переданный `writeText` (обычно clipboard API).
 * Отказ или его отсутствие — `fallback` (выделение textarea). Оба отказа — false.
 */
export async function writeCopiedText(
  value: string,
  io: Readonly<{
    writeText?: (value: string) => Promise<void>;
    fallback?: (value: string) => boolean;
  }>,
): Promise<boolean> {
  if (io.writeText) {
    try {
      await io.writeText(value);
      return true;
    } catch {
      // Браузер не дал записать в буфер — пробуем выделение.
    }
  }
  try {
    return io.fallback ? io.fallback(value) : false;
  } catch {
    return false;
  }
}

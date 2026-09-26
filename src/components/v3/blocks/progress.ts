/**
 * Полоса прогресса (Э1.3): «N из M» только из прочитанных чисел. Нет чтения,
 * пустой набор или числа, которые не сходятся, — полосы нет: число не
 * оценивается и не достраивается («нет чтения — нет числа»).
 */
export type ProgressView = Readonly<{
  done: number;
  total: number;
  /** Доля в процентах, 0–100, для ширины заливки. */
  percent: number;
  /** «3 из 7» и слово, если оно передано: «3 из 7 принято». */
  label: string;
}>;

const count = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function progressOf(
  done: number | null | undefined,
  total: number | null | undefined,
  word?: string,
): ProgressView | null {
  if (!count(done) || !count(total) || total === 0 || done > total) return null;
  const suffix = word?.trim();
  return Object.freeze({
    done,
    total,
    percent: Math.round((done / total) * 1000) / 10,
    label: `${done} из ${total}${suffix ? ` ${suffix}` : ""}`,
  });
}

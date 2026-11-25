// Дата в истории попыток: как на сайте (`TestsCatalog.tsx`): `Intl.DateTimeFormat(ky | ru-RU, { dateStyle: "medium", timeZone: "UTC" })`.
// Это дата завершения в UTC без времени, а не «день по Бишкеку», как у CSCA. Движок Hermes мог остаться без кыргызской
// локали или без `timeZone`: тогда подпись идёт на русской локали, затем по местному поясу, затем числом `ГГГГ-ММ-ДД`, но не падает.
export function assessmentDateLabel(value: string, lang: "ru" | "ky"): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const attempts: readonly (() => string)[] = [
    () => new Intl.DateTimeFormat(lang === "ky" ? "ky" : "ru-RU", { dateStyle: "medium", timeZone: "UTC" }).format(date),
    () => new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "UTC" }).format(date),
    () => new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(date),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // следующая попытка
    }
  }
  return date.toISOString().slice(0, 10);
}

// Дата в истории попыток: как на сайте (`TestsCatalog.tsx`): `Intl.DateTimeFormat(ky | ru-RU, { dateStyle: "medium", timeZone: "UTC" })`.
// Это дата завершения в UTC без времени, а не «день по Бишкеку», как у CSCA.
//
// Про запасные пути. Движок без кыргызской локали НЕ бросает ошибку: `new Intl.DateTimeFormat("ky")` молча берёт локаль
// устройства (у англоязычного телефона получилось бы «Nov 9, 2026»). Поэтому наличие локали проверяется заранее
// (`supportedLocalesOf`): нет кыргызской - русская, нет и русской - число `ГГГГ-ММ-ДД`. Ошибку (`RangeError`) бросает только
// то, чего движок не умеет по существу: часовой пояс `UTC` в `timeZone` или сам `Intl`; тогда подпись идёт по местному поясу,
// затем числом. Ни один из путей не роняет экран.
function supported(locale: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

export function assessmentDateLabel(value: string, lang: "ru" | "ky"): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const locale = lang === "ky" && supported("ky") ? "ky" : supported("ru-RU") ? "ru-RU" : null;
  if (locale !== null) {
    const attempts: readonly (() => string)[] = [
      () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date),
      () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date),
    ];
    for (const attempt of attempts) {
      try {
        return attempt();
      } catch {
        // следующая попытка
      }
    }
  }
  return date.toISOString().slice(0, 10);
}

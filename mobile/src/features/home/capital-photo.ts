// Фото столицы выбранной страны: фон шапки «Главной» (веб `capitalPhoto`, src/lib/portal/university-tiles.ts, #1489).
// Веб-модуль начинается с `import "server-only"` (адреса фото он собирает на сервере), поэтому страж общих импортов его
// не пропускает; выбор фото здесь тот же, а совпадение таблицы столиц держит тест по тексту веб-файла
// (home-capital-photo.test.ts). Адрес картинки строит `geographyPhotoUrls` (фото каталога лежат в бакете
// `portal-university-photos`, вход для них не нужен).
import type { GeographyPhoto, StudentUniversityIndex } from "@web/lib/portal/university-index";
import { isStudyCountryCode } from "@web/lib/study-countries";

/**
 * Столица страны поступления - город каталога (миграция 283), чьё фото стоит фоном шапки. У ОАЭ Абу-Даби в каталоге
 * нет: берётся фото страны; нет и его - шапка без фото.
 */
export const CAPITAL_CITY: Readonly<Record<string, string>> = {
  CN: "beijing",
  MY: "kuala-lumpur",
  AE: "abu-dhabi",
  TR: "ankara",
  IT: "rome",
  CZ: "prague",
};

/**
 * Фото шапки для страны: фото города-столицы, иначе фото страны, иначе `null`. «Пока не решил», страна вне шести и
 * индекс, который ещё не прочитан или не прочитался, дают `null`: шапка остаётся тёмной плашкой.
 */
export function capitalGeographyPhoto(index: StudentUniversityIndex | null, country: string | null): GeographyPhoto | null {
  if (index === null || country === null || !isStudyCountryCode(country)) return null;
  const city = index.cities.find((item) => item.country === country && item.key === CAPITAL_CITY[country]);
  return city?.photo ?? index.countries.find((item) => item.code === country)?.photo ?? null;
}

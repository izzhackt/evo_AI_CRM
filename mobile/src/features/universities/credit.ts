// Подпись фото: части строки со ссылками и проверка адреса перед открытием. Веб: PhotoRights.tsx (`PhotoCredit`, `fill`),
// university-tiles.ts (`universityPhotoCredit`, `placePhoto`). Чистые функции без React Native: тесты не нуждаются в экране.
import { catalogPhotoSourceMatches } from "@web/lib/catalog-text";

import type { UniversityStrings } from "./model";
import type { PhotoCreditView } from "./photos";

/** Кусок строки подписи; `url` - куда ведёт нажатие, `null` - просто текст. */
export type CreditSegment = Readonly<{ text: string; url: string | null }>;

type CreditStrings = Pick<UniversityStrings, "photoCredit" | "photoCreditSource" | "photoCreditOfficial">;

/**
 * Адрес годится для открытия в браузере, только если он `https`, без логина и пароля, без пробелов и управляющих знаков.
 * Подписи берутся из библиотеки фото и из индекса каталога (его разборщик уже требует `catalogUrl`), но ссылка открывает
 * внешний сайт, поэтому проверка стоит и здесь: испорченная запись не уведёт на `javascript:`, `file:` или чужую схему.
 *
 * Правило намеренно мягче `catalogUrl` (правило базы для ссылок, публикуемых в каталоге: домен с зоной без порта, без `#`, закрытые
 * хосты, ключи в строке запроса). Библиотека фото приложения (`src/lib/university-photo-library.json`) не проходит через базу, и в
 * ней есть настоящие адреса источников, которые это правило отвергает: на 25.11.2026 три из 729 (страница библиотеки вуза CSUFT с
 * явным портом `:443`). Подпись без ссылки на источник нарушила бы условие лицензии там, где адрес безопасен, а задача этой
 * проверки - безопасность открытия, а не допуск в каталог.
 */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001f\u007f-\u009f\s\\]/u.test(value)) return null;
  return /^https:\/\/[^/?#@]+(?:[/?#].*)?$/u.test(value) ? value : null;
}

/** Шаблон словаря с местами `{имя}` и готовыми кусками на их месте (как `fill` в PhotoRights.tsx веба). */
function fill(template: string, slots: Readonly<Record<string, CreditSegment>>): readonly CreditSegment[] {
  return template
    .split(/(\{[a-z]+\})/u)
    .filter((part) => part !== "")
    .map((part) => {
      const name = /^\{([a-z]+)\}$/u.exec(part)?.[1];
      return name !== undefined && Object.hasOwn(slots, name) ? slots[name] : { text: part, url: null };
    });
}

/**
 * Подпись по кнопке «©»: у официальных медиа вуза «Фото: <вуз>, официальный сайт» (вуз - ссылка на страницу источника),
 * у остальных «Фото: <автор>, <лицензия>» или, у фото мест, «Фото: <автор>, <источник>, <лицензия>». Каждое имя ведёт на свою
 * страницу, если она есть; источник фото мест открывается, только если хост адреса принадлежит названному источнику
 * (`catalogPhotoSourceMatches`: Unsplash, Pexels, Wikimedia Commons).
 */
export function creditSegments(credit: PhotoCreditView, strings: CreditStrings, universityName = ""): readonly CreditSegment[] {
  if (credit.kind === "official") {
    return fill(strings.photoCreditOfficial, { university: { text: universityName, url: safeHttpsUrl(credit.sourceUrl) } });
  }
  const author: CreditSegment = { text: credit.author, url: safeHttpsUrl(credit.authorUrl ?? null) };
  const license: CreditSegment = { text: credit.license, url: safeHttpsUrl(credit.licenseUrl) };
  if (credit.sourceName === null) return fill(strings.photoCredit, { author, license });
  const trusted = catalogPhotoSourceMatches(credit.sourceName, credit.sourceUrl);
  const source: CreditSegment = { text: credit.sourceName, url: trusted ? safeHttpsUrl(credit.sourceUrl) : null };
  return fill(strings.photoCreditSource, { author, source, license });
}

/**
 * Куда ведёт нажатие на всю строку подписи (шапка «Главной»): страница источника, если адрес безопасен и, у фото мест, хост принадлежит
 * названному источнику (как у ссылки источника в панели «©»); иначе `null`: строка остаётся текстом без ссылки.
 */
export function creditSourceUrl(credit: PhotoCreditView): string | null {
  if (credit.kind === "author" && credit.sourceName !== null && !catalogPhotoSourceMatches(credit.sourceName, credit.sourceUrl)) return null;
  return safeHttpsUrl(credit.sourceUrl);
}

/** Подпись одной строкой без ссылок (шапка «Главной», читалка). */
export function creditLine(credit: PhotoCreditView, strings: CreditStrings, universityName?: string): string {
  return creditSegments(credit, strings, universityName ?? "")
    .map((segment) => segment.text)
    .join("");
}

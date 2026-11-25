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

/** Подпись одной строкой без ссылок (шапка «Главной», читалка). */
export function creditLine(credit: PhotoCreditView, strings: CreditStrings, universityName?: string): string {
  return creditSegments(credit, strings, universityName ?? "")
    .map((segment) => segment.text)
    .join("");
}

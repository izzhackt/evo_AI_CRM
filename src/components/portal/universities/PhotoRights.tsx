import type { ReactNode } from "react";

import type { PortalStrings } from "@/lib/portal/i18n";

/**
 * Тихая кнопка «©» на фото (план 4.4, контракт 2.5): по нажатию автор,
 * источник и лицензия фото места или «Фото: <вуз>, официальный сайт» у
 * официальных медиа вуза. Строки лицензии под карточкой нет (приёмка
 * 7.6.5), но атрибуция CC BY и CC BY-SA остаётся рядом с самим фото на
 * каждом экране. Без клиентского кода: `<details>` открывается мышью,
 * касанием и с клавиатуры, поэтому кнопку рисуют и сервер, и клиентский
 * поиск.
 */

export type PhotoCredit =
  | Readonly<{ kind: "author"; author: string; authorUrl: string | null; license: string; licenseUrl: string | null }>
  | Readonly<{ kind: "official"; sourceUrl: string }>;

export type PhotoRightsStrings = Pick<PortalStrings<"universities">, "photoRights" | "photoCredit" | "photoCreditOfficial" | "newTab">;

function External({ href, children, newTab }: { href: string | null; children: ReactNode; newTab: string }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="pt-sr-only"> {newTab}</span>
    </a>
  );
}

/** Шаблон словаря с местами `{имя}` и готовыми узлами на их месте. */
function fill(template: string, slots: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return template.split(/(\{[a-z]+\})/u).map((part, index) => {
    const slot = /^\{([a-z]+)\}$/u.exec(part)?.[1];
    return slot !== undefined && Object.hasOwn(slots, slot)
      ? <span key={index}>{slots[slot]}</span>
      : part;
  });
}

export function PhotoRights({
  credit,
  universityName,
  strings,
  placement,
}: {
  credit: PhotoCredit;
  /** Название вуза для «Фото: <вуз>, официальный сайт». */
  universityName?: string;
  strings: PhotoRightsStrings;
  /** Угол фото: сверху у мест (снизу на них текст), снизу у вузов (сверху сердечко). */
  placement: "top" | "bottom";
}) {
  const text = credit.kind === "official"
    ? fill(strings.photoCreditOfficial, {
        university: <External href={credit.sourceUrl} newTab={strings.newTab}>{universityName ?? ""}</External>,
      })
    : fill(strings.photoCredit, {
        author: <External href={credit.authorUrl} newTab={strings.newTab}>{credit.author}</External>,
        license: <External href={credit.licenseUrl} newTab={strings.newTab}>{credit.license}</External>,
      });
  return (
    <details className={`pt-photo-rights pt-photo-rights-${placement}`}>
      <summary className="pt-photo-rights-btn" aria-label={strings.photoRights} title={strings.photoRights}>
        <span aria-hidden="true">©</span>
      </summary>
      <p className="pt-photo-rights-text">{text}</p>
    </details>
  );
}

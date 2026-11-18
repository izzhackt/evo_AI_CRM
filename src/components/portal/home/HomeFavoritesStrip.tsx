"use client";

import type { ReactNode } from "react";

/**
 * Список карточек «Моих вузов». На телефоне это лента вбок, и карточку, видную наполовину, браузер при фокусе с
 * клавиатуры не докручивает: фокус стоит на скрытой части. Ближайшая прокрутка к фокусу возвращает карточку целиком.
 */
export function HomeFavoritesStrip({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ul
      className="pt-home-fav-grid"
      data-testid="home-favorites"
      onFocus={(event) => {
        if (event.target instanceof HTMLElement) event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }}
    >
      {children}
    </ul>
  );
}

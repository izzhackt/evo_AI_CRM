"use client";

import { useSyncExternalStore } from "react";

/**
 * Куда Radix рисует окна, панели и меню. По умолчанию — в `body`, а токены «Нового вида» лежат на корне
 * staff CRM (`.v3-world[data-ui="next"]`, ui-next.css): в `body` панель вышла бы без цветов и шрифтовых ролей.
 * Поэтому все примитивы с порталом берут контейнер отсюда. Корень находится после гидратации (на сервере и в
 * первом проходе — `undefined`, Radix возьмёт `body`); портал открывается позже, когда контейнер уже известен.
 * Читается именно в хуке, а не при каждом открытии: содержимое `Select` и `Popover` создаётся при монтировании.
 */
export function useUiPortalContainer(): HTMLElement | undefined {
  return useSyncExternalStore(subscribeNothing, findRoot, noRoot) ?? undefined;
}

const subscribeNothing = () => () => {};
const findRoot = () => document.querySelector<HTMLElement>('.v3-world[data-ui="next"]');
const noRoot = () => null;

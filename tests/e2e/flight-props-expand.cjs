"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Свойства ленивого входа, как они пересекают границу сервер → клиент (RSC): серверные компоненты внутри свойств (слоты `toolbar`,
 * `period`, `children`…) выполняются на сервере, и пересекает границу их результат, а не их свойства (у них бывают функции: `leadHref`,
 * `periodHref`). Эта проверка раскрывает серверные компоненты (функции без `"use client"`; стенды помечают клиентские модули
 * `__useClient`) и отдаёт получившееся дерево `assertFlightProps`: проверяются свойства клиентских компонентов и данные, а не серверная кухня.
 */
const { assertFlightProps } = require("./flight-props.cjs");

const isServerComponent = (type) => typeof type === "function" && !type.__useClient && !/Loadable/u.test(type.displayName ?? type.name ?? "");
const isPlain = (value) => value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

async function expand(value) {
  if (Array.isArray(value)) return Promise.all(value.map(expand));
  if (value === null || typeof value !== "object") return value;
  if (value.$$typeof) {
    let element = value;
    while (element && typeof element === "object" && element.$$typeof && isServerComponent(element.type)) {
      element = await element.type(element.props);
      if (Array.isArray(element)) return expand(element);
    }
    if (!element || typeof element !== "object" || !element.$$typeof) return expand(element);
    const props = {};
    for (const [key, item] of Object.entries(element.props ?? {})) props[key] = await expand(item);
    return { ...element, props };
  }
  if (isPlain(value)) return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await expand(item)])));
  return value;
}

/** Бросает, если среди свойств (после раскрытия серверных компонентов) есть то, что RSC не сериализует. */
async function assertFlightPropsExpanded(props, label) {
  assertFlightProps(await expand(props), label);
}

module.exports = { assertFlightPropsExpanded };

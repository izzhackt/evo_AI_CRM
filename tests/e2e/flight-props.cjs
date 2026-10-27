"use strict";

/**
 * Свойства, которые серверная страница отдаёт ленивому клиентскому входу (`TodayNextLazy`, `TasksNextLazy`, …), проходят
 * границу сервер → клиент: RSC сериализует только данные. Здесь это проверяется на настоящих свойствах настоящей страницы:
 * допустимы примитивы, `Date`, `Map`, `Set`, массивы, простые объекты и элементы React; функции (кроме ссылок на серверные
 * действия), экземпляры классов и символы — нет (ошибка в сборке не видна, она всплыла бы на первом заходе администратора).
 */
const SERVER_REFERENCE = Symbol.for("react.server.reference");

function problems(value, path, seen = new Set()) {
  if (value === null || value === undefined) return [];
  const type = typeof value;
  if (["string", "number", "boolean", "bigint"].includes(type)) return [];
  if (type === "symbol") return [`${path}: символ`];
  if (type === "function") return value.$$typeof === SERVER_REFERENCE ? [] : [`${path}: функция`];
  if (seen.has(value)) return [];
  seen.add(value);
  if (value instanceof Date) return [];
  if (value instanceof Map) return [...value].flatMap(([key, item], index) => [...problems(key, `${path}[map key ${index}]`, seen), ...problems(item, `${path}[map ${index}]`, seen)]);
  if (value instanceof Set) return [...value].flatMap((item, index) => problems(item, `${path}[set ${index}]`, seen));
  if (Array.isArray(value)) return value.flatMap((item, index) => problems(item, `${path}[${index}]`, seen));
  if (value.$$typeof) return problems(value.props, `${path}.props`, seen); // элемент React: его свойства
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return [`${path}: экземпляр ${proto.constructor?.name ?? "класса"}`];
  return Object.entries(value).flatMap(([key, item]) => problems(item, `${path}.${key}`, seen));
}

/** Бросает, если среди свойств есть то, что RSC не сериализует. */
function assertFlightProps(props, label) {
  const found = problems(props, label);
  if (found.length) throw new Error(`свойства ленивого входа не сериализуются (RSC):\n${found.slice(0, 8).join("\n")}`);
}

module.exports = { assertFlightProps };

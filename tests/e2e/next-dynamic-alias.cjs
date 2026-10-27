"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Стенды на Node (require-хуки без сборки Next): `next/dynamic` здесь — версия для pages router, которая рисует пустоту,
 * пока модуль не загружен. Сборка Next подставляет версию для App Router (`React.lazy` + Suspense), её и берёт стенд:
 * тогда страницы с ленивым новым видом (`TodayNextLazy`, `RequestsNextLazy`, …) рисуются так же, как в сборке.
 * Подключать раньше любого `require` страницы или компонента.
 */
const Module = require("node:module");

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  return resolveFilename.call(this, request === "next/dynamic" ? "next/dist/shared/lib/app-dynamic" : request, ...rest);
};

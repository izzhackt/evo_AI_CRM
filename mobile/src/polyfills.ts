// Hermes на iPhone не содержит `Intl.PluralRules` (проверено на симуляторе iOS 26.5,
// 09.11.2026: «undefined cannot be used as a constructor»), а общий код веба
// (components/portal/csca/session-labels.ts: «закрывается через N дней») его зовёт.
// Подключается первой строкой корневого макета. Пока `Intl.PluralRules` есть в среде
// и считает правильно, polyfill ничего не меняет. Данные только для RU и KY, остальные
// языки приложению не нужны.
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/ru.js";
import "@formatjs/intl-pluralrules/locale-data/ky.js";

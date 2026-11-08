import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  NO_CITY_LABEL,
  buildCampusPins,
  cityHref,
  compareByLocale,
  countryHref,
  groupByCity,
  groupCountryUniversities,
  hasNoQuery,
  labelCityKey,
  normalizeCityLabel,
  parseCountryView,
  parseGeoCityParam,
  parseGeoCountryCode,
  universityCityRef,
} from "../src/lib/university-geo-groups.ts";

// Синтетические данные: настоящих карточек и людей здесь нет.
let counter = 0;
const card = (name, city, photoKey = null) => ({ id: `id-${++counter}`, content: { name, city, photoKey } });
const names = (group) => group.items.map((item) => item.content.name);

test("города А→Я по локали, вузы внутри города А→Я, группа без города последняя", () => {
  const groups = groupCountryUniversities([
    card("Яблоко", "Шэньчжэнь"), card("Берёза", null), card("Альфа", "Ухань"), card("Ёлка", "Ухань"), card("абрикос", "Ухань"),
    card("Эльбрус", "Пекин"), card("Дуб", ""), card("Город", "  "), card("Вишня", "Пекин"),
  ], null);
  assert.deepEqual(groups.map((group) => group.label), ["Пекин", "Ухань", "Шэньчжэнь", NO_CITY_LABEL]);
  assert.equal(groups.at(-1).key, null);
  assert.deepEqual(names(groups[0]), ["Вишня", "Эльбрус"]);
  // Регистр не важен, «ё» стоит рядом с «е»: абрикос, Альфа, Ёлка.
  assert.deepEqual(names(groups[1]), ["абрикос", "Альфа", "Ёлка"]);
  assert.deepEqual(names(groups.at(-1)), ["Берёза", "Город", "Дуб"]);
});

test("каждый вуз ровно в одной группе, пустой вход даёт пустой список", () => {
  const items = [card("А", "Пекин"), card("Б", null), card("В", "пекин ")];
  const groups = groupCountryUniversities(items, null);
  assert.equal(groups.reduce((sum, group) => sum + group.items.length, 0), items.length);
  assert.equal(groups.length, 2, "«Пекин» и «пекин » одна группа");
  assert.deepEqual(groupCountryUniversities([], null), []);
});

test("только вузы без города: одна группа «Город не указан»", () => {
  const groups = groupCountryUniversities([card("Б", null), card("А", null)], null);
  assert.deepEqual(groups.map((group) => [group.key, group.label, names(group)]), [[null, NO_CITY_LABEL, ["А", "Б"]]]);
});

test("числа в названиях сравниваются по значению, порядок не зависит от входа", () => {
  const forward = [card("Колледж 10", "Город"), card("Колледж 2", "Город"), card("Колледж 1", "Город")];
  const one = groupCountryUniversities(forward, null)[0];
  const two = groupCountryUniversities([...forward].reverse(), null)[0];
  assert.deepEqual(names(one), ["Колледж 1", "Колледж 2", "Колледж 10"]);
  assert.deepEqual(names(two), names(one));
  assert.ok(compareByLocale("Zeta", "alpha") > 0 && compareByLocale("alpha", "Zeta") < 0);
  assert.equal(compareByLocale("Same", "Same"), 0);
});

test("подпись группы не зависит от порядка входа", () => {
  const a = groupByCity([{ n: "1", c: "Пекин" }, { n: "2", c: "пекин" }], (x) => ({ key: labelCityKey(x.c), label: x.c }), (x) => x.n);
  const b = groupByCity([{ n: "2", c: "пекин" }, { n: "1", c: "Пекин" }], (x) => ({ key: labelCityKey(x.c), label: x.c }), (x) => x.n);
  assert.equal(a[0].label, b[0].label);
});

test("нормализация подписи города", () => {
  assert.equal(normalizeCityLabel("  Куала   Лумпур "), "Куала Лумпур");
  assert.equal(normalizeCityLabel(""), null);
  assert.equal(normalizeCityLabel("   "), null);
  assert.equal(normalizeCityLabel(null), null);
  assert.equal(labelCityKey("Пекин"), "~пекин");
});

test("менеджер: город по ключу справочника, подпись по названию сливается с ним", () => {
  const directory = {
    cities: [{ key: "beijing", nameRu: "Пекин", nameEn: "Beijing" }, { key: "wuhan", nameRu: "Ухань", nameEn: "Wuhan" }],
    institutions: [],
  };
  const keyed = card("А", "Beijing");
  const byName = card("Б", "пекин");
  const linked = card("В", "Другое имя");
  directory.institutions.push({ id: linked.id, cityKey: "wuhan" }, { id: keyed.id, cityKey: null });
  assert.deepEqual(universityCityRef(linked, directory), { key: "wuhan", label: "Ухань" });
  assert.deepEqual(universityCityRef(keyed, directory), { key: "beijing", label: "Пекин" });
  assert.deepEqual(universityCityRef(byName, directory), { key: "beijing", label: "Пекин" });
  assert.deepEqual(universityCityRef(card("Г", "Чэнду"), directory), { key: "~чэнду", label: "Чэнду" });
  assert.equal(universityCityRef(card("Д", null), directory), null);
  // Без справочника только подпись карточки.
  assert.deepEqual(universityCityRef(keyed, null), { key: "~beijing", label: "Beijing" });
  const groups = groupCountryUniversities([keyed, byName, linked], directory);
  assert.deepEqual(groups.map((group) => [group.key, names(group)]), [["beijing", ["А", "Б"]], ["wuhan", ["В"]]]);
});

test("точки карты только у вузов с проверенной координатой, остальные считаются", () => {
  const geo = JSON.parse(readFileSync(new URL("../src/lib/university-geo-library.json", import.meta.url), "utf8"));
  const [known] = Object.keys(geo);
  const items = [
    { id: "a", name: "С точкой", photoKey: known },
    { id: "b", name: "Без ключа фото", photoKey: null },
    { id: "c", name: "Ключ без координаты", photoKey: "no-such-campus-key" },
    { id: "d", name: "Ключ прототипа", photoKey: "toString" },
  ];
  const { pins, missing } = buildCampusPins(items, (item) => `Город · ${item.name}`);
  assert.equal(missing, 3);
  assert.deepEqual(pins, [{ id: "a", name: "С точкой", place: "Город · С точкой", lat: geo[known].lat, lng: geo[known].lng }]);
  assert.deepEqual(buildCampusPins([], () => ""), { pins: [], missing: 0 });
});

test("код страны в адресе: две заглавные латинские буквы", () => {
  for (const ok of ["CN", "MY", "PL"]) assert.equal(parseGeoCountryCode(ok), ok);
  for (const bad of ["cn", "C", "CNN", "C1", "", " CN", "../", undefined, null, 1]) assert.equal(parseGeoCountryCode(bad), null, String(bad));
});

test("?view= страны: города по умолчанию, лишние параметры и неизвестные виды отклоняются", () => {
  assert.equal(parseCountryView({}), "cities");
  assert.equal(parseCountryView({ view: undefined }), "cities");
  for (const view of ["cities", "list", "map"]) assert.equal(parseCountryView({ view }), view);
  for (const bad of [{ view: "table" }, { view: "" }, { view: ["map", "list"] }, { view: "MAP" }, { q: "x" }, { view: "map", offset: "30" }]) {
    assert.equal(parseCountryView(bad), null, JSON.stringify(bad));
  }
  assert.equal(hasNoQuery({}), true);
  assert.equal(hasNoQuery({ a: undefined }), true);
  assert.equal(hasNoQuery({ a: "1" }), false);
});

test("город в адресе: ключ справочника, «~подпись», «~» и ничего другого", () => {
  assert.deepEqual(parseGeoCityParam("beijing"), { kind: "key", key: "beijing" });
  assert.deepEqual(parseGeoCityParam("kuala-lumpur"), { kind: "key", key: "kuala-lumpur" });
  assert.deepEqual(parseGeoCityParam("~"), { kind: "none", key: null });
  assert.deepEqual(parseGeoCityParam("~куала лумпур"), { kind: "label", key: "~куала лумпур" });
  for (const bad of ["", "Beijing", "bei jing", "-a", "a-", "a--b", "x", "~ ", "~a  b", "~\u0000", " ~a", "~a\n", undefined, null, 5, "a".repeat(65)]) {
    assert.equal(parseGeoCityParam(bad), undefined, JSON.stringify(bad));
  }
});

test("адреса страны и города", () => {
  assert.equal(countryHref("CN"), "/universities/country/CN");
  assert.equal(countryHref("CN", "cities"), "/universities/country/CN");
  assert.equal(countryHref("CN", "list"), "/universities/country/CN?view=list");
  assert.equal(countryHref("MY", "map"), "/universities/country/MY?view=map");
  assert.equal(cityHref("CN", "beijing"), "/universities/country/CN/beijing");
  assert.equal(cityHref("CN", null), "/universities/country/CN/~");
  assert.equal(cityHref("CN", "~куала лумпур"), "/universities/country/CN/~%D0%BA%D1%83%D0%B0%D0%BB%D0%B0%20%D0%BB%D1%83%D0%BC%D0%BF%D1%83%D1%80");
  // Адрес города разбирается обратно в тот же ключ.
  assert.equal(parseGeoCityParam(decodeURIComponent(cityHref("CN", "~куала лумпур").split("/").pop())).key, "~куала лумпур");
});

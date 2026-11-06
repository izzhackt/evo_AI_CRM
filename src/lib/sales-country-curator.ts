/**
 * Куратор страны в «Отчёте продаж» (решение владельца 06.11.2026: «ученик выбрал страну в анкете — куратор этой страны
 * выбирается сам»; пока Китай и Малайзия). Куратора дела назначает продажа, поэтому форма подставляет его сама: страна
 * берётся из анкеты лида или из поля «Страна», куратор — из «Настройки → Кураторы стран» (миграция 335). Не задан — выбор
 * остаётся ручным.
 */
export type SalesCountryDirection = "CN" | "MY";

const DIRECTION_BY_WORD: Readonly<Record<string, SalesCountryDirection>> = {
  cn: "CN", china: "CN", "китай": "CN", "кытай": "CN",
  my: "MY", malaysia: "MY", "малайзия": "MY",
};

/** Код анкеты («CN») или текст поля «Страна» («Китай», «Malaysia») → направление; иначе null. */
export function salesCountryDirection(value: string | null | undefined): SalesCountryDirection | null {
  const word = (value ?? "").trim().toLowerCase().replace(/ё/g, "е");
  return DIRECTION_BY_WORD[word] ?? null;
}

/** Куратор страны из настройки; нет направления или куратор не задан — null. */
export function salesCountryCurator(
  countryCurators: Readonly<Partial<Record<SalesCountryDirection, string>>>,
  direction: SalesCountryDirection | null,
): string | null {
  return direction ? countryCurators[direction] ?? null : null;
}

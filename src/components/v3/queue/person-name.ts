/**
 * Короткое имя человека для плотной строки очереди: «Имя Фамилия» →
 * «Имя Ф.». Полное имя остаётся в подсказке строки, в колонке и в панели.
 * Имя из одного слова или со второй частью не с буквы («Администратор
 * (синтетический)») не сокращается.
 */
export function shortPersonName(name: string): string {
  const [first, second] = name.trim().split(/\s+/u);
  if (!first || !second || !/^\p{L}/u.test(second)) return name.trim();
  return `${first} ${second.slice(0, 1)}.`;
}

/**
 * Инициалы для нейтрального круга (Э1.3): первые буквы двух первых слов,
 * которые начинаются с буквы: «Имя Фамилия» → «ИФ», «Администратор
 * (синтетический)» → «А». Пустое имя — пустая строка: круг не рисуется.
 */
export function personInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .filter((part) => /^\p{L}/u.test(part))
    .slice(0, 2)
    .map((part) => (Array.from(part)[0] ?? "").toLocaleUpperCase("ru-RU"))
    .join("");
}

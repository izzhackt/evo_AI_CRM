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

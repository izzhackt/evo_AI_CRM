/** Инициалы аккаунта: первые буквы двух первых слов имени («Айбек Токтогулов» → «АТ»). */
export function accountInitials(name: string): string {
  const letters = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toLocaleUpperCase() || "?";
}

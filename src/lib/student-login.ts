/**
 * Логин студента (07.11.2026): имя.фамилия латиницей, как в загранпаспорте (ICAO 9303, плюс кыргызские ң, ө, ү).
 * Студент логин не выбирает: его строит приложение, база выдаёт первый свободный вариант (340 claim_student_login_v1).
 */

const ICAO: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "ie", ы: "y", ь: "", э: "e", ю: "iu", я: "ia", ң: "ng", ө: "o", ү: "u", һ: "h",
};

const LOGIN_SHAPE = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/u;
const PART_MAX = 24;

function latinPart(value: string): string {
  const latin = [...value.normalize("NFC").toLowerCase()]
    .map((char) => ICAO[char] ?? char)
    .join("")
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[^a-z0-9]/gu, "");
  return latin.slice(0, PART_MAX);
}

/** «Айдай», «Чынарова» → «aidai.chynarova». Пустая часть становится «student». */
export function studentLoginBase(firstName: string, lastName: string): string {
  const first = latinPart(firstName) || "student";
  const last = latinPart(lastName) || "student";
  const login = `${/^[a-z]/u.test(first) ? first : `s${first}`}.${last}`;
  return LOGIN_SHAPE.test(login) ? login : "student.student";
}

/** Ввод в поле «Логин»: логин студента (без «@»), приведённый к виду в базе, или null. */
export function normalizeStudentLogin(value: string): string | null {
  const login = value.trim().toLowerCase();
  if (login.includes("@") || login.length < 3 || login.length > 64 || !LOGIN_SHAPE.test(login)) return null;
  return login;
}

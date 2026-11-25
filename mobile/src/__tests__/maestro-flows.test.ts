// Потоки Maestro (mobile/.maestro): системный запрос «Сохранить пароль?» после входа приходит на языке СИСТЕМЫ (русский
// симулятор показывает «Не сейчас», а не «Not Now»), поэтому его закрывает один общий подпоток с подписями на многих языках,
// а не английская подпись в каждом потоке. Maestro здесь не запускается: тест читает файлы потоков и проверяет подпись тем же
// выражением, что читает Maestro (регулярное выражение, подпись целиком, без учёта регистра; точка - любой знак, в том
// числе неразрывный пробел, который в русской подписи некоторых окон iOS стоит вместо обычного).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MAESTRO = path.resolve(__dirname, "../../.maestro");
const SUBFLOW = "dismiss-save-password.yaml";

function flowFiles(dir: string = MAESTRO): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return flowFiles(full);
    return entry.name.endsWith(".yaml") ? [full] : [];
  });
}
const text = (file: string): string => readFileSync(file, "utf8");
const rel = (file: string): string => path.relative(MAESTRO, file);

/** Подпись кнопки отказа так, как её сравнивает Maestro: выражение из подпотока, подпись целиком, без учёта регистра. */
function dismissLabel(): RegExp {
  const match = /^\s+text: '([^']+)'$/m.exec(text(path.join(MAESTRO, "subflows", SUBFLOW)));
  if (!match) throw new Error("подпоток должен задавать `text: '<выражение>'` в одинарных кавычках");
  return new RegExp(`^(?:${match[1]})$`, "isu");
}

/** Подписи кнопки «Не сейчас» из системных строк iOS 26.5 (ключ «Not Now») и из окна автозаполнения Android (AOSP). */
const DISMISS: Record<string, string[]> = {
  "iOS: английский и языки проекта": ["Not Now", "Не сейчас", "Не сейчас", "Не зараз", "Қазір емес"],
  "iOS: европейские": ["Sonra", "Später", "Plus tard", "Décider plus tard", "Ahora no", "Agora não", "Non ora", "Nie teraz", "Niet nu", "Ei nyt", "Όχι τώρα"],
  "iOS: азиатские и другие": ["ليس الآن", "לא כעת", "अभी नहीं", "ไม่ใช่ตอนนี้", "以后", "稍後再說", "今はしない", "지금 안 함", "Để sau", "Bukan Sekarang"],
  "Android: английский и русский": ["Not now", "No thanks", "Нет, спасибо"],
  "Android: киргизский, казахский, украинский, узбекский": ["Азыр эмес", "Жок, рахмат", "Жоқ, рақмет", "Ні, дякую", "Keyinroq", "Kerak emas"],
};

/** Что нажимать нельзя: согласие сохранить, постоянный отказ, надписи самого приложения, лишний текст вокруг подписи. */
const KEEP = ["Save", "Save Password", "Сохранить", "Сохранить пароль", "Сактоо", "Never", "Никогда", "Эч качан", "Загрузить", "Спросить куратора", "Продолжить", "Войти", "Not Now, thanks", "Не сейчас, спасибо"];

describe("потоки Maestro: окно «Сохранить пароль?» на любом языке системы", () => {
  it("подпоток закрывает кнопку отказа на языках системы (iOS и Android)", () => {
    const label = dismissLabel();
    for (const [group, labels] of Object.entries(DISMISS)) {
      for (const value of labels) expect({ group, value, matches: label.test(value) }).toEqual({ group, value, matches: true });
    }
  });

  it("подпоток не нажимает «Сохранить», постоянный отказ и надписи приложения", () => {
    const label = dismissLabel();
    for (const value of KEEP) expect({ value, matches: label.test(value) }).toEqual({ value, matches: false });
  });

  it("подпоток необязателен: окна нет (Android, автозаполнение выключено) - поток идёт дальше", () => {
    expect(text(path.join(MAESTRO, "subflows", SUBFLOW))).toMatch(/^\s+optional: true$/m);
  });

  it("каждый поток, что вводит пароль, после ввода вызывает этот подпоток", () => {
    const typing = flowFiles().filter((file) => text(file).includes("inputText: ${MAESTRO_E2E_PASSWORD}"));
    // вход: общий подпоток и два потока со своим входом (01 - с неверным паролем сначала, 10 - экран конфиденциальности)
    expect(typing.map(rel).sort()).toEqual(["01-sign-in.yaml", "10-consent-gate.yaml", "subflows/login.yaml"]);
    for (const file of typing) {
      const source = text(file);
      const afterPassword = source.slice(source.lastIndexOf("inputText: ${MAESTRO_E2E_PASSWORD}"));
      expect({ file: rel(file), dismisses: new RegExp(`runFlow: (subflows/)?${SUBFLOW.replace(".", "\\.")}`).test(afterPassword) }).toEqual({ file: rel(file), dismisses: true });
    }
  });

  it("ни один другой поток не ловит окно по одной подписи (английской или русской)", () => {
    for (const file of flowFiles().filter((candidate) => path.basename(candidate) !== SUBFLOW)) {
      expect({ file: rel(file), text: /["'](Not Now|Не[  ]сейчас)["']/i.test(text(file)) }).toEqual({ file: rel(file), text: false });
    }
  });
});

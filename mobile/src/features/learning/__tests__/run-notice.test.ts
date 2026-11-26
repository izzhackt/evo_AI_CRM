// Плашка над заданиями теста (G58, G59): что сказать и какую кнопку предложить в каждом состоянии. Правила - блок `errorNotice` веба;
// строка «ответы ещё не сохранены» и «Выйти без сохранения» добавлены для телефона (ревью #1559).
import { ASSESSMENT_LEAVE_AFTER_FAILURES } from "@/features/learning/tests/assessment-session";
import { isBlocked, runNotice } from "@/features/learning/tests/run-notice";

const base = { error: null, saveStatus: "saved", reloadRequired: false, reload: "idle", unsaved: false, failures: 0 } as const;
const notice = (patch: Partial<Parameters<typeof runNotice>[0]>, exit = false) => runNotice({ ...base, ...patch }, exit);
const NOTE = "assess.unsavedNote";

describe("плашка теста", () => {
  it("всё хорошо: плашки нет", () => {
    expect(notice({})).toEqual({ messages: [], actions: [] });
    expect(notice({ saveStatus: "dirty", unsaved: true })).toEqual({ messages: [], actions: [] });
    expect(notice({ saveStatus: "saving", unsaved: true })).toEqual({ messages: [], actions: [] });
  });

  it("конфликт: текст обещает «Показать сохранённые ответы» - и действие то же; не удалось прочитать - своя строка, действие остаётся", () => {
    expect(notice({ error: "conflict", reloadRequired: true, saveStatus: "unconfirmed", unsaved: true })).toEqual({ messages: ["error.conflict", NOTE], actions: ["loadSaved"] });
    expect(notice({ error: "unavailable", reloadRequired: true, reload: "failed", saveStatus: "unconfirmed", unsaved: true })).toEqual({ messages: ["reloadUnavailable", NOTE], actions: ["loadSaved"] });
  });

  it("сохранение не подтверждено (обрыв): «Не удалось подтвердить сохранение», «Повторить сохранение» и строка, что ответы ещё не сохранены", () => {
    expect(notice({ saveStatus: "unconfirmed", unsaved: true })).toEqual({ messages: ["error.unavailable", NOTE], actions: ["retrySave"] });
  });

  it("сбой завершения при несохранённом ответе: та же строка и тот же повтор; когда всё сохранено, кнопка повтора и строка про несохранённое не нужны (повторяет «Завершить»)", () => {
    expect(notice({ error: "unavailable", saveStatus: "unconfirmed", unsaved: true })).toEqual({ messages: ["error.unavailable", NOTE], actions: ["retrySave"] });
    expect(notice({ error: "unavailable" })).toEqual({ messages: ["error.unavailable"], actions: [] });
  });

  it("окончательные отказы: своя строка, повторять нечего, держать студента не за что (строки про несохранённое нет)", () => {
    expect(notice({ error: "denied", saveStatus: "unconfirmed" })).toEqual({ messages: ["error.denied"], actions: [] });
    expect(notice({ error: "invalid" })).toEqual({ messages: ["error.invalid"], actions: [] });
    expect(notice({ error: "deadline_passed" })).toEqual({ messages: ["error.unavailable"], actions: [] });
  });

  it("попытка уйти раньше подтверждения: строка «Сначала сохраним…», после конфликта «Сначала нажмите «Показать сохранённые ответы»»", () => {
    expect(notice({ saveStatus: "unconfirmed", unsaved: true }, true).messages).toEqual(["error.unavailable", "exitBlocked", NOTE]);
    expect(notice({ saveStatus: "dirty", unsaved: true }, true).messages).toEqual(["exitBlocked"]);
    expect(notice({ error: "conflict", reloadRequired: true, saveStatus: "unconfirmed", unsaved: true }, true).messages).toEqual(["error.conflict", "reloadBeforeExit", NOTE]);
  });
});

describe("«Выйти без сохранения» (ревью #1559: упорный сбой запирал экран навсегда)", () => {
  const failing = { saveStatus: "unconfirmed", unsaved: true } as const;

  it("до трёх неудачных попыток подряд кнопки нет, на третьей она появляется рядом с повтором", () => {
    expect(ASSESSMENT_LEAVE_AFTER_FAILURES).toBe(3);
    expect(notice({ ...failing, failures: 1 }).actions).toEqual(["retrySave"]);
    expect(notice({ ...failing, failures: 2 }).actions).toEqual(["retrySave"]);
    expect(notice({ ...failing, failures: 3 }).actions).toEqual(["retrySave", "leaveAnyway"]);
    expect(notice({ ...failing, failures: 7 }).actions).toEqual(["retrySave", "leaveAnyway"]);
  });

  it("после конфликта и неудачных чтений сохранённого она тоже появляется, рядом с «Показать сохранённые ответы»", () => {
    const conflict = { error: "unavailable", reloadRequired: true, reload: "failed", saveStatus: "unconfirmed", unsaved: true } as const;
    expect(notice({ ...conflict, failures: 2 }).actions).toEqual(["loadSaved"]);
    expect(notice({ ...conflict, failures: 3 }).actions).toEqual(["loadSaved", "leaveAnyway"]);
  });

  it("когда запирать нечем (всё сохранено, окончательный отказ), кнопки нет, сколько бы ни было неудач в счётчике", () => {
    expect(notice({ failures: 5 }).actions).toEqual([]);
    expect(notice({ error: "denied", saveStatus: "unconfirmed", failures: 5 }).actions).toEqual([]);
  });

  it("на телефоне, где жест назад выключен (iPhone), плашка называет и это; без сбоя и там её нет", () => {
    expect(runNotice({ ...base, ...failing }, false, true).messages).toEqual(["error.unavailable", NOTE, "assess.swipeOff"]);
    expect(runNotice({ ...base, ...failing }, false, false).messages).toEqual(["error.unavailable", NOTE]);
    expect(runNotice({ ...base, saveStatus: "saving", unsaved: true }, false, true).messages).toEqual([]);
  });

  it("isBlocked: сбой при несохранённом (обрыв, сверка или неудачные повторы подряд), но не обычная отправка и не сохранённое", () => {
    const state = { saveStatus: "saved", reloadRequired: false, unsaved: false, failures: 0 } as const;
    expect(isBlocked({ ...state, saveStatus: "unconfirmed", unsaved: true })).toBe(true);
    expect(isBlocked({ ...state, saveStatus: "dirty", reloadRequired: true, unsaved: true })).toBe(true);
    expect(isBlocked({ ...state, saveStatus: "dirty", unsaved: true })).toBe(false);
    expect(isBlocked({ ...state, saveStatus: "saving", unsaved: true })).toBe(false); // первая отправка: обычная
    expect(isBlocked({ ...state, saveStatus: "unconfirmed", unsaved: false })).toBe(false);
    // Повтор идёт (статус «сохраняем») или студент выбрал другой ответ («есть несохранённые»), а сбой тот же: плашка не гаснет.
    expect(isBlocked({ ...state, saveStatus: "saving", unsaved: true, failures: 1 })).toBe(true);
    expect(isBlocked({ ...state, saveStatus: "dirty", unsaved: true, failures: 2 })).toBe(true);
    expect(isBlocked({ ...state, saveStatus: "saved", unsaved: false, failures: 2 })).toBe(false);
  });
});

describe("повтор в полёте не прячет плашку и «Выйти без сохранения» (ревью #1581)", () => {
  const retrying = { unsaved: true } as const;

  it("статус «сохраняем» или «есть несохранённые» при неудачных повторах: те же строки и те же кнопки, что при «не подтверждено»", () => {
    const unconfirmed = notice({ ...retrying, saveStatus: "unconfirmed", failures: 1 });
    expect(unconfirmed).toEqual({ messages: ["error.unavailable", NOTE], actions: ["retrySave"] });
    for (const saveStatus of ["saving", "dirty"] as const) {
      expect(notice({ ...retrying, saveStatus, failures: 1 })).toEqual(unconfirmed);
    }
  });

  it("кнопка «Выйти без сохранения» остаётся на всё время повторов: на третьей неудаче появилась, пока летит четвёртая отправка - на месте", () => {
    for (const saveStatus of ["unconfirmed", "saving", "dirty"] as const) {
      expect(notice({ ...retrying, saveStatus, failures: 3 }).actions).toEqual(["retrySave", "leaveAnyway"]);
    }
  });

  it("ошибка другого рода при несохранённом и неудачных повторах: её строка и повтор, а не пустая плашка", () => {
    expect(notice({ ...retrying, saveStatus: "saving", error: "unavailable", failures: 2 })).toEqual({ messages: ["error.unavailable", NOTE], actions: ["retrySave"] });
  });

  it("первая отправка, ещё без неудач, плашку не рисует (обычное сохранение), и когда всё сохранено, она гаснет", () => {
    expect(notice({ ...retrying, saveStatus: "saving", failures: 0 })).toEqual({ messages: [], actions: [] });
    expect(notice({ saveStatus: "saved", failures: 0 })).toEqual({ messages: [], actions: [] });
  });
});

describe("квитанцию записи не удалось прочитать (ревью #1581)", () => {
  it("строка без «повторите запрос» и без кнопок: повторять нечего, защита снята", () => {
    expect(notice({ error: "unreadable", saveStatus: "unconfirmed" })).toEqual({ messages: ["assess.receiptUnreadable"], actions: [] });
  });
});

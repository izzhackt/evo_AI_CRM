// Плашка над заданиями теста (G58, G59): что сказать и какую кнопку предложить в каждом состоянии. Правила - блок `errorNotice` веба.
import { runNotice } from "@/features/learning/tests/run-notice";

const base = { error: null, saveStatus: "saved", reloadRequired: false, reload: "idle", unsaved: false } as const;
const notice = (patch: Partial<Parameters<typeof runNotice>[0]>, exit = false) => runNotice({ ...base, ...patch }, exit);

describe("плашка теста", () => {
  it("всё хорошо: плашки нет", () => {
    expect(notice({})).toEqual({ messages: [], action: null });
    expect(notice({ saveStatus: "dirty", unsaved: true })).toEqual({ messages: [], action: null });
  });

  it("конфликт: текст обещает «Показать сохранённые ответы» - и действие то же; не удалось прочитать - своя строка, действие остаётся", () => {
    expect(notice({ error: "conflict", reloadRequired: true, saveStatus: "unconfirmed", unsaved: true })).toEqual({ messages: ["error.conflict"], action: "loadSaved" });
    expect(notice({ error: "unavailable", reloadRequired: true, reload: "failed", saveStatus: "unconfirmed", unsaved: true })).toEqual({ messages: ["reloadUnavailable"], action: "loadSaved" });
  });

  it("сохранение не подтверждено (обрыв): «Не удалось подтвердить сохранение» и «Повторить сохранение»", () => {
    expect(notice({ saveStatus: "unconfirmed", unsaved: true })).toEqual({ messages: ["error.unavailable"], action: "retrySave" });
  });

  it("сбой завершения при несохранённом ответе: та же строка и тот же повтор; когда всё сохранено, кнопка повтора не нужна (повторяет «Завершить»)", () => {
    expect(notice({ error: "unavailable", saveStatus: "unconfirmed", unsaved: true })).toEqual({ messages: ["error.unavailable"], action: "retrySave" });
    expect(notice({ error: "unavailable" })).toEqual({ messages: ["error.unavailable"], action: null });
  });

  it("окончательные отказы: своя строка, повторять нечего", () => {
    expect(notice({ error: "denied", saveStatus: "unconfirmed" })).toEqual({ messages: ["error.denied"], action: null });
    expect(notice({ error: "invalid" })).toEqual({ messages: ["error.invalid"], action: null });
    expect(notice({ error: "deadline_passed" })).toEqual({ messages: ["error.unavailable"], action: null });
  });

  it("попытка уйти раньше подтверждения: строка «Сначала сохраним…», после конфликта «Сначала нажмите «Показать сохранённые ответы»»", () => {
    expect(notice({ saveStatus: "unconfirmed", unsaved: true }, true).messages).toEqual(["error.unavailable", "exitBlocked"]);
    expect(notice({ saveStatus: "dirty", unsaved: true }, true).messages).toEqual(["exitBlocked"]);
    expect(notice({ error: "conflict", reloadRequired: true, saveStatus: "unconfirmed", unsaved: true }, true).messages).toEqual(["error.conflict", "reloadBeforeExit"]);
  });
});

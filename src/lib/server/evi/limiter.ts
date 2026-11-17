import "server-only";

/*
 * Частота вызовов Эви в памяти процесса: не больше 40 ответов на ученика за 10 минут и 150 за сутки, 1200 на весь
 * кабинет за час. Суточный потолок не даёт одному ученику «Новыми чатами» потратить заметную часть бюджета ключа.
 * Это защита от зацикленной кнопки и случайной лавины, а не учёт денег: месячный потолок трат владелец задаёт в
 * Claude Console на ключе Эви (решение 16.11.2026). Счёт живёт до перезапуска приложения и не хранит ни текстов,
 * ни имён — только время вызовов по идентификатору пользователя.
 */

const STUDENT_WINDOW_MS = 10 * 60_000;
const STUDENT_MAX = 40;
const STUDENT_DAY_MS = 24 * 60 * 60_000;
const STUDENT_DAY_MAX = 150;
const GLOBAL_WINDOW_MS = 60 * 60_000;
const GLOBAL_MAX = 1_200;

const perStudent = new Map<string, number[]>();
let global: number[] = [];

function fresh(times: readonly number[], now: number, window: number): number[] {
  return times.filter((time) => now - time < window);
}

/** Резервирует один ответ; false — лимит исчерпан, вызывать модель нельзя. */
export function takeEviSlot(userId: string, now: number = Date.now()): boolean {
  global = fresh(global, now, GLOBAL_WINDOW_MS);
  // У ученика хранятся вызовы за сутки (не больше 150 отметок): из них же считается и окно в 10 минут.
  const mine = fresh(perStudent.get(userId) ?? [], now, STUDENT_DAY_MS);
  const recent = mine.filter((time) => now - time < STUDENT_WINDOW_MS).length;
  if (global.length >= GLOBAL_MAX || recent >= STUDENT_MAX || mine.length >= STUDENT_DAY_MAX) {
    perStudent.set(userId, mine);
    return false;
  }
  mine.push(now);
  global.push(now);
  perStudent.set(userId, mine);
  if (perStudent.size > 5_000) {
    for (const [key, times] of perStudent) if (fresh(times, now, STUDENT_DAY_MS).length === 0) perStudent.delete(key);
  }
  return true;
}

/** Только для тестов: чистый счётчик. */
export function resetEviSlots(): void {
  perStudent.clear();
  global = [];
}

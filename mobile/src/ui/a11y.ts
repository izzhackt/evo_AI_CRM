// Общие помощники доступности (аудит паритета 25.11.2026, G6): сказать читалке короткое сообщение и, после слияния
// #1545, «Уменьшить движение». Только ядро React Native (`AccessibilityInfo`): новых нативных модулей нет, поэтому
// всё, что пользуется этим файлом, уходит к студентам обновлением EAS Update на той же сборке.
import { AccessibilityInfo } from "react-native";

/**
 * Окно, в котором то же самое сообщение второй раз не озвучивается: двойной вызов эффекта, быстрый повтор нажатия.
 * Отсчёт идёт от последнего озвученного, поэтому настоящий повтор позже окна читалка скажет снова.
 */
export const ANNOUNCE_REPEAT_MS = 800;

let lastText = "";
let lastAt = 0;

/**
 * Сказать читалке (VoiceOver, TalkBack) короткое сообщение, не двигая фокус: «Верно», «Сообщение отправлено»,
 * «Осталась минута». Работает одинаково на iPhone и Android (`AccessibilityInfo.announceForAccessibility`); без
 * включённой читалки ничего не происходит.
 *
 * - Пустая строка, пробелы, `null` и `undefined` не озвучиваются.
 * - То же сообщение подряд в течение `ANNOUNCE_REPEAT_MS` озвучивается один раз.
 * - Сбой системного вызова не доходит до экрана: озвучивание необязательно, действие студента важнее.
 */
export function announce(message: string | null | undefined): void {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return;
  const now = Date.now();
  const elapsed = now - lastAt;
  // `elapsed < 0`: часы ушли назад; окно тогда не работает, повтор не глушим.
  if (text === lastText && elapsed >= 0 && elapsed < ANNOUNCE_REPEAT_MS) return;
  lastText = text;
  lastAt = now;
  try {
    AccessibilityInfo.announceForAccessibility(text);
  } catch {
    // Озвучивание необязательно: сбой читалки не должен ломать нажатие.
  }
}

/** Для тестов: забыть последнее сообщение, чтобы тесты друг друга не глушили. */
export function resetAnnouncementsForTests(): void {
  lastText = "";
  lastAt = 0;
}

// ---- «Уменьшить движение» -------------------------------------------------------------------------------------------
// TODO(после слияния #1545): хук `useReducedMotion()` живёт в `ui/motion.tsx` (PR #1545, ветка `mobile/home-parity`).
// Второй такой хук здесь НЕ писать. Когда #1545 попадёт в main:
//   1. добавить сюда одну строку: `export { useReducedMotion } from "@/ui/motion";`
//   2. `Skeleton` в `ui/CardParts.tsx` (G6): при включённом «Уменьшить движение» рисовать статичный блок без
//      `Animated.loop` (веб: статичный скелетон, `portal/loading.tsx`), остальное оставить как есть;
//   3. тест в `ui/__tests__/CardParts.test.tsx`: в `jest.setup.ts` после #1545 движение выключено по умолчанию
//      (`setReducedMotionForTests(true)`), ветку с пульсацией проверять через `setReducedMotionForTests(false)`.

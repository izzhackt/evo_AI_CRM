// Общие помощники доступности (аудит паритета 25.11.2026, G6): сказать читалке короткое сообщение и «Уменьшить
// движение». Только ядро React Native (`AccessibilityInfo`): новых нативных модулей нет, поэтому всё, что пользуется
// этим файлом, уходит к студентам обновлением EAS Update на той же сборке.
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
// Хук живёт в `ui/motion.tsx` (PR #1545): он читает системную настройку один раз при старте и следит за её сменой.
// Здесь он только доступен рядом с остальными помощниками доступности, второй такой хук писать не нужно.
export { useReducedMotion } from "@/ui/motion";

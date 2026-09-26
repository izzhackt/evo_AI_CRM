/**
 * Срок «Отменить» после паузы (Э1.3, новый облик): пока фокус или указатель
 * на строке «Отменить» (UndoToast), срок не идёт. После паузы срок каждой
 * строки сдвигается на ту часть паузы, что прошла после её завершения:
 * завершённая до паузы строка получает всю паузу, завершённая во время паузы —
 * время с завершения. Оставшееся время не теряется и не прибавляется.
 * Файл без React: его проверяет unit-тест.
 */
export function resumedUndoDeadline(
  entry: Readonly<{ expiresAt: number; completedAt: number }>,
  heldSince: number,
  now: number,
): number {
  return entry.expiresAt + Math.max(0, now - Math.max(heldSince, entry.completedAt));
}

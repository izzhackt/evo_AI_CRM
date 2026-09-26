/**
 * Строка уведомления о сообщении в переписке по делу. Когда пишет сам
 * студент дела, автор и дело — один человек, и «X написал(а) в переписке ·
 * X» повторяло имя (аудит 26.09): имя дела добавляется, только если автор
 * другой. Без автора или дела — нейтральная фраза.
 */
export function caseMessageNotificationCopy(
  actorDisplayName: string | null,
  studentDisplayName: string | null,
): string {
  const actor = actorDisplayName?.trim();
  const student = studentDisplayName?.trim();
  if (!actor || !student) return "Новое сообщение в переписке по делу";
  return actor.toLocaleLowerCase("ru-RU") === student.toLocaleLowerCase("ru-RU")
    ? `${actor} написал(а) в переписке`
    : `${actor} написал(а) в переписке · ${student}`;
}

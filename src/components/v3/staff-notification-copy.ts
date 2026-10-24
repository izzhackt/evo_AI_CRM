/**
 * Строка уведомления о сообщении в переписке по делу: «Автор: новое сообщение
 * в переписке». Когда пишет сам студент дела, автор и дело — один человек, и
 * имя повторялось бы (аудит 26.09): имя дела добавляется, только если автор
 * другой. Без автора или дела — нейтральная фраза. Без «написал(а)»: рода
 * автора CRM не знает.
 */
export function caseMessageNotificationCopy(
  actorDisplayName: string | null,
  studentDisplayName: string | null,
): string {
  const actor = actorDisplayName?.trim();
  const student = studentDisplayName?.trim();
  if (!actor || !student) return "Новое сообщение в переписке по делу";
  return actor.toLocaleLowerCase("ru-RU") === student.toLocaleLowerCase("ru-RU")
    ? `${actor}: новое сообщение в переписке`
    : `${actor}: новое сообщение в переписке · ${student}`;
}

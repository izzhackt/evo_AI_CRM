/** Ответ команды создания, как его показывает диалог. */
export type ComposerAttemptStatus = "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable";

/**
 * Ключ создания (`request_id`) диалога «Новая задача» — один на черновик,
 * пока сервер не скажет, что он израсходован.
 *
 * «Сохранение пока не подтверждено» (`unavailable`, в том числе брошенная
 * ошибка и ответ без задачи) значит: задача могла сохраниться, а ответ
 * потерялся. Повтор обязан прийти с тем же ключом — `create_case_task` и
 * `mutate_staff_task` вернут ту же задачу, а не создадут вторую. Так же
 * держал ключ прежний календарный вход (скрытый `request_id` = ключ ответа).
 * Отказы `invalid`, `forbidden`, `stale` откатывают команду целиком — ключ
 * не записан, и повтор с ним безопасен; `idle` — ответа не было вовсе.
 *
 * Новый ключ — только когда старый израсходован: подтверждённое сохранение
 * («Создать ещё») или `request_conflict` (ключ уже использован с другими данными).
 */
export function nextComposerRequestId(
  status: ComposerAttemptStatus,
  current: string,
  fresh: () => string = () => crypto.randomUUID(),
): string {
  return status === "saved" || status === "request_conflict" ? fresh() : current;
}

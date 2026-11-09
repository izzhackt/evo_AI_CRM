/**
 * Черновик анкеты на устройстве (#1362). Живёт в localStorage и переживает закрытие вкладки, но хранит только ответы,
 * шаг и почту: пароль и согласия не попадают сюда никогда. У записи есть время создания и срок 30 дней, как у черновика
 * приложения (mobile/src/features/registration/draft-store.ts). Файл без React и без обращения к хранилищу на импорте,
 * его берут и мастер анкеты, и экран статуса.
 *
 * Ключ v2: прежний sessionStorage-черновик (`evo-application-draft-v1`) был рассчитан на девять шагов, его номер шага
 * к семи не подходит, поэтому он не читается и удаляется.
 */
export const APPLICATION_DRAFT_KEY = "evo-application-draft-v2";
export const LEGACY_APPLICATION_DRAFT_KEY = "evo-application-draft-v1";
export const APPLICATION_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Годен ли сохранённый черновик: с отметкой времени и не старше 30 дней. */
export function applicationDraftFresh(parsed: unknown, now: number): boolean {
  const createdAt = (parsed as { createdAt?: unknown } | null)?.createdAt;
  return typeof createdAt === "number" && now - createdAt >= 0 && now - createdAt <= APPLICATION_DRAFT_MAX_AGE_MS;
}

/**
 * Экран статуса: анкета принята сервером, поэтому анонимный черновик и черновики этого студента для прежних ревизий
 * больше не нужны. Черновик правки текущей ревизии остаётся.
 */
export function clearObsoleteApplicationDrafts(storage: Pick<Storage, "removeItem" | "key" | "length">, ownerId: string, revision: number): void {
  const prefix = `${APPLICATION_DRAFT_KEY}:${ownerId}:`;
  const obsolete: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) && Number(key.slice(prefix.length)) < revision) obsolete.push(key);
  }
  for (const key of obsolete) storage.removeItem(key);
  storage.removeItem(APPLICATION_DRAFT_KEY);
}

/**
 * Ровно то, что уходит в хранилище: ответы, шаг, почта и время создания. Явная копия без `consent` и без любых полей
 * пароля и согласий: даже ошибка вызывающего кода не сохранит их.
 */
export function serializeApplicationDraft(
  values: Readonly<Record<string, unknown>>, step: number, submittedEmail: string, accountEmail: string, createdAt: number,
): string {
  const answers: Record<string, unknown> = { ...values };
  delete answers.consent;
  delete answers.password;
  delete answers.aiConsent;
  return JSON.stringify({ v: 2, createdAt, step, values: answers, submittedEmail, accountEmail });
}

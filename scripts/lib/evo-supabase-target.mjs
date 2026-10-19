// Какую базу Supabase операторский скрипт вправе трогать: облачный проект EVO или
// self-hosted стек (docs/runbooks/selfhosted-cutover.md). Адреса точные, без шаблонов:
// ни `*.supabase.co`, ни другой хост через эту функцию не проходят.
// Облачная ветка удаляется после переключения (#1271).

export const SELFHOSTED_SUPABASE_ORIGIN = "https://supabase.evoadmissions.com";

/**
 * `rawUrl` — значение NEXT_PUBLIC_SUPABASE_URL (допускается один завершающий «/»).
 * Возвращает цель или null.
 */
export function matchSupabaseTarget(rawUrl, cloudProjectRef) {
  if (typeof rawUrl !== "string") return null;
  const candidates = [
    ["cloud", `https://${cloudProjectRef}.supabase.co`],
    ["selfhosted", SELFHOSTED_SUPABASE_ORIGIN],
  ];
  for (const [kind, origin] of candidates) {
    if (rawUrl === origin || rawUrl === `${origin}/`) return Object.freeze({ kind, origin });
  }
  return null;
}

/**
 * Claim `ref` в JWT service_role. У ключей облака он равен ref проекта. У ключей
 * self-hosted его нет, поэтому проверка явно пропускается; ключ с чужим `ref`
 * (облачный) к self-hosted не принимается. Подпись проверяет сервер.
 */
export function jwtRefAcceptable(payloadRef, target, cloudProjectRef) {
  return target.kind === "selfhosted"
    ? payloadRef === undefined
    : payloadRef === cloudProjectRef;
}

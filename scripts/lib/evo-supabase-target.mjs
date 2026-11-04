// Какую базу Supabase операторский скрипт вправе трогать: только self-hosted стек EVO
// (docs/adr/0037-use-only-self-hosted-supabase.md). Адрес точный, без шаблонов: ни другой
// хост, ни облачный проект через эту функцию не проходят.

export const SELFHOSTED_SUPABASE_ORIGIN = "https://supabase.evoadmissions.com";

/**
 * `rawUrl` — значение NEXT_PUBLIC_SUPABASE_URL (допускается один завершающий «/»).
 * Возвращает цель или null.
 */
export function matchSupabaseTarget(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  if (rawUrl === SELFHOSTED_SUPABASE_ORIGIN || rawUrl === `${SELFHOSTED_SUPABASE_ORIGIN}/`) {
    return Object.freeze({ kind: "selfhosted", origin: SELFHOSTED_SUPABASE_ORIGIN });
  }
  return null;
}

/**
 * Claim `ref` в JWT service_role. У ключей self-hosted его нет; ключ с любым `ref`
 * (например, от облачного проекта) не принимается. Подпись проверяет сервер.
 */
export function jwtRefAcceptable(payloadRef) {
  return payloadRef === undefined;
}

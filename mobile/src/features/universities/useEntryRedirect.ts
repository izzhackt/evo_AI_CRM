import { router, useNavigation } from "expo-router";
import { useEffect } from "react";

/**
 * Вход в каталог: страна студента заменяет экран входа. Если экран этой страны уже есть в
 * стеке каталога (повторное «Университеты»), `dismissTo` возвращается к нему, а не кладёт
 * второй такой же поверх; иначе `replace`, и экрана входа в истории не остаётся.
 */
export function useEntryRedirect(country: string | null) {
  const navigation = useNavigation();
  useEffect(() => {
    if (country === null) return;
    const slug = country.toLowerCase();
    const href = `/universities/country/${slug}` as never;
    const routes: readonly { name?: string; params?: unknown }[] = navigation.getState()?.routes ?? [];
    const open = routes.some((route) => route.name?.startsWith("country/") && (route.params as { code?: string } | undefined)?.code === slug);
    if (open) router.dismissTo(href);
    else router.replace(href);
  }, [country, navigation]);
}

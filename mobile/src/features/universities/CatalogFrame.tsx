// Каркас экранов каталога: страница с тягой вниз (всегда проверяет версию индекса),
// скелетон, плашка сбоя, строка «показан сохранённый каталог». Данные - `useUniversityIndex`.
import type { StudentUniversityIndex } from "@web/lib/portal/university-index";
import { useCallback, type ReactNode } from "react";
import { View } from "react-native";

import { loadErrorKey } from "@/api/queries";
import { useLang } from "@/i18n/LangProvider";
import { useFocusEffect } from "@/lib/focus";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

import { useUniversityIndex } from "./hooks";
import { closeCreditPanel } from "./PhotoCredit";

export function CatalogFrame({ children, header }: { children: (index: StudentUniversityIndex) => ReactNode; header?: ReactNode }) {
  const { t, m } = useLang();
  const strings = t("universities");
  const catalog = useUniversityIndex();
  // Возврат на экран каталога (назад с карточки вуза, с другой вкладки): версия каталога перепроверяется, если давно не проверялась.
  const { recheck } = catalog;
  useFocusEffect(
    useCallback(() => {
      recheck();
    }, [recheck]),
  );
  return (
    <Screen topInset={false} tabBar onRefresh={() => void catalog.refresh()} refreshing={catalog.refreshing}>
      {/* Касание содержимого (мимо подписи фото) и начало прокрутки закрывают открытую панель «©». */}
      <View style={{ gap: 16 }} onTouchStart={closeCreditPanel} testID="catalog-content">
        {header}
        {catalog.isLoading ? (
          <CardSkeleton label={`${strings.title}. ${m("state.loading")}`} lines={3} testID="catalog-loading" />
        ) : catalog.isError || catalog.index === null ? (
          <InlineAlert message={m(loadErrorKey(catalog.error) === "error.load" ? "uni.unavailable" : loadErrorKey(catalog.error))} retryLabel={m("gate.retry")} onRetry={() => void catalog.refresh()} testID="catalog-error" />
        ) : (
          <>
            {catalog.refreshFailed ? (
              <Text variant="caption" tone="text2" testID="catalog-stale">
                {m("uni.refreshFailed")}
              </Text>
            ) : null}
            {children(catalog.index)}
          </>
        )}
      </View>
    </Screen>
  );
}

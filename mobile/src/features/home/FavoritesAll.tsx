// «Всё избранное» на «Главной» (веб FavoritesSection.tsx и FavoritesView.tsx, `/portal?all=1#list`): весь список избранных
// вузов карточками каталога, у каждой флажок «Сравнивать: <вуз>», под списком раздел «Сравнение» - таблица свойств выбранных
// вузов (от двух). Над списком «Больше нет в каталоге: N» для вузов стран, которых больше нет в списке продукта (282).
// Читается только пока список открыт (`useAllFavorites`): «Главная» сама держит четыре первые карточки.
import { Check, Landmark } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { loadErrorKey } from "@/api/queries";
import { COMPARE_MIN, compareRows, publishedTile, selectedUniversities, type CompareRow } from "@/features/home/favorites-compare";
import { useAllFavorites, useHiddenFavorites } from "@/features/home/favorites-queries";
import { go } from "@/features/portal/navigation";
import { useFavoriteState } from "@/features/universities/FavoritesContext";
import { UniversityTileView } from "@/features/universities/cards";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, EmptyBlock, InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Ширина колонки свойств и колонки вуза в таблице: две колонки вузов шире экрана, остальное прокручивается вбок (веб `.pt-compare-scroll`). */
const PROPERTY_WIDTH = 124;
const UNIVERSITY_WIDTH = 188;

/** Флажок «Сравнивать: <вуз>» над карточкой (веб `label.pt-compare-pick`): цель нажатия 44 pt. */
function ComparePick({ id, label, checked, onToggle }: { id: string; label: string; checked: boolean; onToggle: () => void }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onToggle}
      testID={`compare-pick-${id}`}
      style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 12 }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: checked ? tokens.accent : tokens.controlEdge, backgroundColor: checked ? tokens.accent : tokens.surface, alignItems: "center", justifyContent: "center" }}
      >
        {checked ? <Check size={16} strokeWidth={3} color={tokens.onAccent} /> : null}
      </View>
      <Text variant="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Таблица сравнения (веб `CompareTable`): первая колонка - свойства, дальше по колонке на вуз; шире экрана - прокручивается
 * вбок. Читалка получает ячейки с полной подписью «вуз. свойство: значение» (у веб-таблицы читалка знает заголовки строки и
 * столбца, у ячеек приложения такой связи нет), видимые заголовки для неё скрыты.
 */
function CompareTable({ names, rows, propertyLabel }: { names: readonly { id: string; name: string }[]; rows: readonly CompareRow[]; propertyLabel: string }) {
  const { tokens } = useTheme();
  const cell = { padding: 12, borderBottomWidth: 1, borderBottomColor: tokens.line, borderRightWidth: 1, borderRightColor: tokens.line };
  return (
    <ScrollView horizontal testID="compare-scroll" showsHorizontalScrollIndicator style={{ borderWidth: 1, borderColor: tokens.line, borderRadius: tokens.radiusItem }}>
      <View testID="compare-table">
        <View style={{ flexDirection: "row", backgroundColor: tokens.bg }}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[cell, { width: PROPERTY_WIDTH }]}>
            <Text variant="caption" tone="text2" bold>
              {propertyLabel}
            </Text>
          </View>
          {names.map((item) => (
            <View key={item.id} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[cell, { width: UNIVERSITY_WIDTH }]} testID={`compare-head-${item.id}`}>
              <Text variant="secondary" bold>
                {item.name}
              </Text>
            </View>
          ))}
        </View>
        {rows.map((row) => (
          <View key={row.key} style={{ flexDirection: "row" }} testID={`compare-row-${row.key}`}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[cell, { width: PROPERTY_WIDTH, backgroundColor: tokens.bg }]}>
              <Text variant="secondary" tone="text2" bold>
                {row.label}
              </Text>
            </View>
            {row.cells.map((item) => (
              <View
                key={item.id}
                accessible
                accessibilityLabel={`${item.name}. ${row.label}: ${item.lines.join("; ")}`}
                style={[cell, { width: UNIVERSITY_WIDTH, gap: 4 }]}
                testID={`compare-cell-${row.key}-${item.id}`}
              >
                {item.lines.map((line, index) => (
                  // Ближайший набор - моноширинным, как `pt-data` в веб-таблице.
                  <Text key={`${index}-${line}`} variant={row.key === "intake" ? "data" : "secondary"}>
                    {line}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function FavoritesAll({ now }: { now: Date }) {
  const { lang, m, t, format } = useLang();
  const strings = t("favorites");
  const universities = t("universities");
  const all = useAllFavorites(true);
  const hidden = useHiddenFavorites(true);
  const marks = useFavoriteState();
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  if (all.data === undefined) {
    return all.status === "error" ? (
      <InlineAlert message={m(loadErrorKey(all.error))} retryLabel={m("gate.retry")} onRetry={() => void all.refetch()} testID="favorites-all-error" />
    ) : (
      <CardSkeleton label={`${strings.title}. ${m("state.loading")}`} testID="favorites-all-loading" />
    );
  }
  // Число «вне каталога» читается отдельным запросом, а список ждёт и его: иначе строка «Больше нет в каталоге: N» всплывала бы над
  // уже нарисованными карточками и сдвигала их (веб рисует обе части одним ответом сервера). Сбой этого числа список не прячет:
  // ошибка - ноль, как `.catch(() => 0)` веба; приостановленное чтение (нет сети) тоже не держит список.
  if (hidden.isPending && hidden.fetchStatus !== "paused") {
    return <CardSkeleton label={`${strings.title}. ${m("state.loading")}`} testID="favorites-all-loading" />;
  }

  const items = all.data.items;
  const hiddenCount = hidden.data ?? 0;
  // Вуз пропал из избранного, а потом вернулся (убрали и добавили снова): прежняя отметка «Сравнивать» не воскресает. Лишние отметки
  // сбрасываются прямо при отрисовке (без эффекта, как состояние «Главной» по ссылке), а в этой же отрисовке уже не учитываются.
  const itemIds = new Set(items.map((item) => item.id));
  const keptIds = selectedIds.filter((id) => itemIds.has(id));
  if (keptIds.length !== selectedIds.length) setSelectedIds(keptIds);
  const selected = selectedUniversities(items, keptIds);
  const toggle = (id: string) => setSelectedIds((previous) => (previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]));

  return (
    <View style={{ gap: 16 }} testID="favorites-all-view">
      {hiddenCount > 0 ? (
        <Text variant="secondary" tone="text2" testID="favorites-hidden">
          {format(strings.hiddenCount, { count: String(hiddenCount) })}
        </Text>
      ) : null}
      {items.length === 0 ? (
        <EmptyBlock
          icon={Landmark}
          title={strings.emptyTitle}
          body={strings.emptyBody}
          action={<Button variant="ghost" label={strings.emptyAction} onPress={() => go("/universities")} testID="favorites-all-open-catalog" />}
        />
      ) : (
        <>
          <Text variant="secondary" tone="text2" testID="favorites-saved">
            {format(strings.savedCount, { count: String(items.length) })}
          </Text>
          <View accessibilityRole="list" style={{ gap: 20 }}>
            {items.map((item) => (
              <View key={item.id} style={{ gap: 4 }} testID={`favorite-entry-${item.id}`}>
                <ComparePick id={item.id} label={format(strings.compareSelect, { name: item.content.name })} checked={keptIds.includes(item.id)} onToggle={() => toggle(item.id)} />
                {/* Запись из избранного по определению: сердечко закрашено, пока его состояние не прочитано (после снятия - как в каталоге). */}
                <UniversityTileView tile={publishedTile(item, universities, lang, now)} strings={universities} favored={marks.isFavored(item.id) ?? true} onToggle={marks.toggle} />
              </View>
            ))}
          </View>
          <View style={{ gap: 12 }} testID="compare-section">
            <Text variant="heading" accessibilityRole="header">
              {strings.compareHeading}
            </Text>
            {selected.length >= COMPARE_MIN ? (
              <CompareTable
                names={selected.map((item) => ({ id: item.id, name: item.content.name }))}
                rows={compareRows(selected, strings, universities, lang, now)}
                propertyLabel={strings.compareProperty}
              />
            ) : (
              <Text variant="secondary" tone="text2" testID="compare-hint">
                {strings.compareHint}
              </Text>
            )}
          </View>
        </>
      )}
    </View>
  );
}

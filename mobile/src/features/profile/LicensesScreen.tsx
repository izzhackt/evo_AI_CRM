// «Лицензии сторонних библиотек»: список из сгенерированного JSON, поиск по названию, тексты по нажатию.
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { openExternal } from "@/features/profile/external";
import { filterLicenses, loadLicenses, safeProjectUrl, type LicenseEntry } from "@/features/profile/licenses";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function LicensesScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { m, format } = useLang();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Загрузка JSON только пока экран открыт.
  const data = useMemo(() => (visible ? loadLicenses() : null), [visible]);
  const rows = useMemo(() => (data ? filterLicenses(data, query) : []), [data, query]);
  const rowId = (e: LicenseEntry) => `${e.kind}:${e.name}@${e.version}`;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: tokens.bg, paddingTop: 16 }} testID="licenses-screen">
        <View style={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
          <Text variant="title" accessibilityRole="header">
            {m("licenses.title")}
          </Text>
          <Text variant="secondary" tone="text2">
            {m("licenses.intro")}
          </Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={m("licenses.search")}
            placeholderTextColor={tokens.text2}
            accessibilityLabel={m("licenses.search")}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            testID="licenses-search"
            style={{ minHeight: 44, borderWidth: 1, borderColor: tokens.controlEdge, borderRadius: tokens.radiusControl, paddingHorizontal: 12, backgroundColor: tokens.surface, color: tokens.text, fontFamily: sansFont(), fontSize: tokens.sizeBody }}
          />
          <Text variant="caption" tone="text2" accessibilityLiveRegion="polite">
            {format(m("licenses.count"), { count: String(rows.length) })}
          </Text>
        </View>
        <FlatList
          data={rows}
          keyExtractor={rowId}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          windowSize={7}
          ListEmptyComponent={
            <Text variant="body" tone="text2" style={{ padding: 16 }}>
              {m("licenses.empty")}
            </Text>
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 16) + 72 }}
          renderItem={({ item }) => {
            const id = rowId(item);
            const expanded = openId === id;
            const text = item.text && data ? data.texts[item.text] : null;
            const site = safeProjectUrl(item.url);
            return (
              <View style={{ borderBottomWidth: 1, borderBottomColor: tokens.line }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() => setOpenId(expanded ? null : id)}
                  testID={`license-row-${item.name}`}
                  style={{ minHeight: MIN_TARGET + 4, justifyContent: "center", paddingVertical: 8, gap: 2 }}
                >
                  <Text variant="body" bold>
                    {item.name}
                    {item.version ? <Text variant="secondary" tone="text2">{`  ${item.version}`}</Text> : null}
                  </Text>
                  <Text variant="caption" tone="text2">
                    {item.license}
                  </Text>
                </Pressable>
                {expanded ? (
                  <View style={{ gap: 8, paddingBottom: 12 }}>
                    {site ? <Button label={m("licenses.openSite")} variant="ghost" onPress={() => void openExternal(site)} /> : null}
                    <Text variant="caption" tone="text2" selectable testID="license-text">
                      {text ?? format(m("licenses.noText"), { license: item.license })}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
        <View style={{ position: "absolute", left: 16, right: 16, bottom: Math.max(insets.bottom, 12) }}>
          <Button label={m("licenses.close")} onPress={onClose} testID="licenses-close" />
        </View>
      </View>
    </Modal>
  );
}

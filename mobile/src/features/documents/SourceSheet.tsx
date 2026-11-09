// Лист «Как добавить файл»: единственный вход загрузки у строки чек-листа (#1361):
// файл, фото из галереи, камера.
import { Camera, FolderOpen, Image as ImageIcon } from "lucide-react-native";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PickSource } from "@/domain/documents-model";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

type Props = { visible: boolean; title: string; onPick: (source: PickSource) => void; onClose: () => void; onDismissed: () => void };

export function SourceSheet({ visible, title, onPick, onClose, onDismissed }: Props) {
  const { tokens } = useTheme();
  const { m } = useLang();
  const insets = useSafeAreaInsets();
  const options: readonly { source: PickSource; label: string; Icon: typeof Camera }[] = [
    { source: "file", label: m("docs.pickFiles"), Icon: FolderOpen },
    { source: "photo", label: m("docs.pickPhoto"), Icon: ImageIcon },
    { source: "camera", label: m("docs.pickCamera"), Icon: Camera },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismissed} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel={m("docs.pickCancel")} accessibilityRole="button" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" }} />
        <View
          testID="source-sheet"
          accessibilityViewIsModal
          style={{ backgroundColor: tokens.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 4 }}
        >
          <Text variant="heading" accessibilityRole="header">
            {m("docs.pickTitle")}
          </Text>
          <Text variant="secondary" tone="text2" numberOfLines={2} style={{ marginBottom: 8 }}>
            {title}
          </Text>
          {options.map(({ source, label, Icon }) => (
            <Pressable
              key={source}
              accessibilityRole="button"
              onPress={() => onPick(source)}
              testID={`pick-${source}`}
              style={({ pressed }) => ({ minHeight: MIN_TARGET + 4, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, borderRadius: tokens.radiusControl, backgroundColor: pressed ? tokens.accentSoft : "transparent" })}
            >
              <Icon size={22} strokeWidth={1.75} color={tokens.accent} />
              <Text variant="body">{label}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={onClose} testID="pick-cancel" style={{ minHeight: MIN_TARGET, alignItems: "center", justifyContent: "center", marginTop: 4 }}>
            <Text variant="body" tone="text2" bold>
              {m("docs.pickCancel")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

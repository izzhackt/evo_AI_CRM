// Объявления для экранной читалки: то, что на вебе делает живая область (`role="log"`, `role="status"`, `role="alert"`). В React Native
// у `role="log"` нет действия, поэтому две дороги по платформам: iOS - `AccessibilityInfo.announceForAccessibility`, Android - живая
// область (`accessibilityLiveRegion`): один постоянный узел размером с точку, чей текст меняется. Узел стоит всегда, потому что
// TalkBack объявляет изменение текста в области, которая уже есть, а появление новой области надёжно не объявляет. На iOS узла нет.
// Одинаковые подряд тексты различаются невидимым знаком, иначе системе нечего «заметить».
import { useCallback, useState, type ReactElement } from "react";
import { AccessibilityInfo, Platform, View } from "react-native";

import { Text } from "@/ui/Text";

export type AnnounceMode = "polite" | "assertive";

const ZERO_WIDTH = "​";

export function useAnnouncer(): Readonly<{
  announce: (text: string, mode?: AnnounceMode) => void;
  /** Живая область Android; на iOS `null`. Ставится один раз в корне экрана. */
  region: ReactElement | null;
}> {
  const [spoken, setSpoken] = useState<Readonly<{ text: string; mode: AnnounceMode; beat: number }>>({ text: "", mode: "polite", beat: 0 });
  const announce = useCallback((text: string, mode: AnnounceMode = "polite") => {
    if (text.length === 0) return;
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(text);
      return;
    }
    setSpoken((current) => ({ text, mode, beat: current.beat + 1 }));
  }, []);
  const region =
    Platform.OS === "ios" ? null : (
      <View
        testID="live-region"
        accessibilityLiveRegion={spoken.mode}
        importantForAccessibility="yes"
        style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "hidden" }}
      >
        <Text variant="caption" testID="live-region-text">
          {spoken.text}
          {spoken.beat % 2 === 0 ? ZERO_WIDTH : ""}
        </Text>
      </View>
    );
  return { announce, region };
}

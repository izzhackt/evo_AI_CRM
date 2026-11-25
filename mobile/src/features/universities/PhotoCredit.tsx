// «©» в углу фото (веб: PhotoRights.tsx): тихая кнопка, по нажатию автор, источник и лицензия со ссылками. Стоит на каждой
// поверхности с фото каталога: карточки стран и городов, карточки вузов, шапки страны, города и вуза. CC BY и CC BY-SA
// требуют указания автора рядом с фото, у фото с сайтов вузов (решение Р3) - источник (аудит паритета 25.11.2026, G41).
//
// Кнопка лежит над фото отдельным элементом, а не внутри нажимаемой карточки: вложенная кнопка не доступна читалке
// (VoiceOver и TalkBack читают карточку как один элемент и скрывают то, что внутри). Как и в вебе, открыта одна панель на
// экране: открытие следующей закрывает прежнюю.
import { useEffect, useId, useSyncExternalStore } from "react";
import { Linking, Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

import { creditLine, creditSegments } from "./credit";
import type { UniversityStrings } from "./model";
import type { PhotoCreditView } from "./photos";

/** Тёмная подложка кнопки и панели: как `rgb(20 16 12 / .55)` и `/ .86` в `.pt-photo-rights` веба, поверх любого фото. */
const BADGE = "rgba(20,16,12,0.55)";
const BADGE_OPEN = "rgba(20,16,12,0.86)";
const INK = "#ffffff";

let openId: string | null = null;
const listeners = new Set<() => void>();

function setOpen(next: string | null) {
  if (openId === next) return;
  openId = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type CreditPlacement = "top" | "bottom";

/**
 * Кнопка «©» и панель подписи. Рисуется поверх фото в углу того родителя, у которого она лежит (родитель - фото или слой
 * над фото карточки). `top` - панель ниже кнопки (фото мест: внизу у них текст), `bottom` - выше (карточки вузов: сверху
 * сердечко). `null` вместо подписи - ничего не рисуется.
 */
export function PhotoCredit({
  credit,
  universityName,
  strings,
  placement = "top",
  testID = "photo-credit",
}: {
  credit: PhotoCreditView | null;
  universityName?: string;
  strings: UniversityStrings;
  placement?: CreditPlacement;
  testID?: string;
}) {
  const { tokens } = useTheme();
  const id = useId();
  const open = useSyncExternalStore(subscribe, () => openId === id, () => false);
  // Размонтированная кнопка не оставляет «открытую» панель, которую уже никто не закроет.
  useEffect(
    () => () => {
      if (openId === id) setOpen(null);
    },
    [id],
  );
  if (credit === null) return null;
  const segments = creditSegments(credit, strings, universityName ?? "");
  const toggle = () => {
    if (open) {
      setOpen(null);
      return;
    }
    setOpen(id);
    announce(creditLine(credit, strings, universityName));
  };
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        right: 2,
        top: placement === "top" ? 2 : undefined,
        bottom: placement === "bottom" ? 2 : undefined,
        maxWidth: "100%",
        alignItems: "flex-end",
        flexDirection: placement === "top" ? "column" : "column-reverse",
        zIndex: 3,
      }}
    >
      {/* Цель нажатия 44, видимый кружок 28 (`.pt-photo-rights-btn`). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.photoRights}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        testID={testID}
        style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
      >
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: open ? BADGE_OPEN : BADGE, alignItems: "center", justifyContent: "center" }}>
          <Text allowFontScaling={false} style={{ color: INK, fontSize: 14, lineHeight: 16 }}>
            ©
          </Text>
        </View>
      </Pressable>
      {open ? (
        <View
          testID={`${testID}-panel`}
          style={{ maxWidth: 260, marginRight: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: tokens.radiusItem, backgroundColor: BADGE_OPEN }}
        >
          <Text style={{ color: INK, fontSize: 12, lineHeight: 17.4 }}>
            {segments.map((segment, index) =>
              segment.url === null ? (
                segment.text
              ) : (
                <Text
                  // Части строки идут в порядке шаблона словаря, их число и места не меняются: номер служит ключом.
                  key={index}
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(segment.url as string).catch(() => undefined)}
                  testID={`${testID}-link`}
                  style={{ color: INK, fontSize: 12, lineHeight: 17.4, textDecorationLine: "underline" }}
                >
                  {segment.text}
                </Text>
              ),
            )}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Высота клавиатуры для Android со сквозным режимом (edge-to-edge): `adjustResize` и
// KeyboardAvoidingView там не поднимают поле ввода над клавиатурой (проверено на эмуляторе API 37:
// поле оставалось под клавиатурой). Высота события не включает панель навигации: её добавляет вызывающий (insets.bottom). На iOS этим занимается KeyboardAvoidingView, там хук отдаёт 0.
import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const show = Keyboard.addListener("keyboardDidShow", (event) => setHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

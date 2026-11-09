import { Stack } from "expo-router";

// Внутри вкладки «Входящие» свой стек: список, чат, лента. Системная «назад» на Android
// возвращает из чата в список, а не на другую вкладку.
export const unstable_settings = { initialRouteName: "index" };

export default function MessagesLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />;
}

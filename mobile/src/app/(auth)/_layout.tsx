import { Stack } from "expo-router";

import { useStatusBarStyle } from "@/theme/useStatusBarStyle";

export default function AuthLayout() {
  const statusBarStyle = useStatusBarStyle();
  return <Stack screenOptions={{ statusBarStyle, headerShown: false, animation: "slide_from_right" }} />;
}

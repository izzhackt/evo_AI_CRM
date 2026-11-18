import { Stack } from "expo-router";

import { useStatusBarStyle } from "@/theme/useStatusBarStyle";

/** «Университеты»: страны -> страна -> город -> вуз; шапку кабинета рисует оболочка выше. */
export default function UniversitiesLayout() {
  const statusBarStyle = useStatusBarStyle();
  return <Stack screenOptions={{ statusBarStyle, headerShown: false, animation: "slide_from_right" }} />;
}

import { Stack } from "expo-router";

/** «Университеты»: страны -> страна -> город -> вуз; шапку кабинета рисует оболочка выше. */
export default function UniversitiesLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />;
}

import { Stack } from "expo-router";

import { useStatusBarStyle } from "@/theme/useStatusBarStyle";

/**
 * «Требования программы»: один экран `[applicationId]` внутри кабинета. Шапку с ☰ и плавающую панель рисует оболочка
 * `(app)/_layout.tsx`, как у `universities/`, `tests/` и `professions/`; раздела в меню у экрана нет (в вебе его тоже нет:
 * сюда ведут «Мои программы», страница вуза, ближайшие даты и уведомления).
 */
export default function PreparationsLayout() {
  const statusBarStyle = useStatusBarStyle();
  return (
    <Stack screenOptions={{ statusBarStyle, headerShown: false, animation: "slide_from_right" }}>
      {/*
        Один экран на все программы: выбор другой программы меняет параметр, а не кладёт ещё один экран в стопку. Скрытая
        вкладка хранит свою стопку, пока студент на других вкладках; без этого «назад» после ухода и возврата попадало
        на программу, которую студент давно закрыл («Главная» -> A -> «К моему поступлению» -> B -> «назад» -> A).
      */}
      <Stack.Screen name="[applicationId]" dangerouslySingular={() => "preparation"} />
    </Stack>
  );
}

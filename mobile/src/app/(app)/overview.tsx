// Прежний раздел «Поступление» (#1355): отдельной страницы больше нет, её содержимое на «Главной».
// Маршрут оставлен перенаправлением, чтобы не ломались старые ссылки и уведомления:
// `/overview?path=open` раскрывает путь, `/overview?view=programs` открывает вкладку «Мои программы».
import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";

export default function OverviewRedirect() {
  const { path, view } = useLocalSearchParams<{ path?: string; view?: string }>();
  const [at] = useState(() => String(Date.now()));
  const params: Record<string, string> = {};
  if (path === "open") params.path = "open";
  params.at = at;
  if (view === "programs") params.list = "programs";
  return <Redirect href={{ pathname: "/home", params }} />;
}

// Прежний раздел «Поступление» (#1355): отдельной страницы больше нет, её содержимое на «Главной».
// Лежит в корне, а не во вкладках (app): скрытая вкладка `href: null` не рисовалась, и ссылка просто попадала на «Главную»
// без параметров. Маршрут оставлен перенаправлением, чтобы не ломались старые ссылки и уведомления:
// `/overview?path=open` раскрывает путь, `/overview?view=programs` открывает вкладку «Мои программы».
import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { overviewRedirectParams } from "@/domain/home-model";

export default function OverviewRedirect() {
  const { path, view } = useLocalSearchParams<{ path?: string; view?: string }>();
  const [at] = useState(() => String(Date.now()));
  return <Redirect href={{ pathname: "/home", params: overviewRedirectParams({ path, view }, at) }} />;
}

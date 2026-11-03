import { redirect } from "next/navigation";

// 03.11.2026: «Избранное» вошло в «Моё поступление» вкладкой «Вузы» (по
// образцу «Мой список» в кабинете пользователя) и ушло из меню. Маршрут
// остаётся подключённым (platform-route-contract.ts), чтобы старые закладки
// и ссылки вели на ту же вкладку; своего чтения у него нет.
export default function StudentPortalFavoritesRedirect() {
  redirect("/portal?view=universities");
}

import { redirect } from "next/navigation";

// #1355 (09.11.2026): «Главная» одна и живёт на /portal; прежний адрес остаётся для старых закладок и писем и
// перенаправляется (307, как остальные перенаправления кабинета). Своего чтения у него нет.
export default function StudentPortalHomeRedirect() {
  redirect("/portal");
}

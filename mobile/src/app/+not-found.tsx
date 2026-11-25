import { NotFoundScreen } from "@/features/app/NotFoundScreen";

/** expo-router показывает этот файл для любого адреса, которого нет в приложении (вместо английского «Unmatched Route»). */
export default function NotFound() {
  return <NotFoundScreen />;
}

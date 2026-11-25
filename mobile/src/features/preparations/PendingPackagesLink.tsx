// Ссылка «Незавершённые отправки на этом устройстве» на «Главной». Показывается, только когда на устройстве есть оборванная
// отправка комплекта (или хранилище не читается: лучше показать, чем спрятать). Веб: `PendingPackagesLink.tsx`.
import { go } from "@/features/portal/navigation";
import { usePendingPackageScopes } from "@/features/preparations/PackageRecovery";
import { usePackageStrings } from "@/features/preparations/package-strings";
import { PACKAGE_RECOVERY_ROUTE } from "@/features/preparations/recovery-route";
import { Button } from "@/ui/Button";

export function PendingPackagesLink() {
  const t = usePackageStrings();
  const { state, scopes } = usePendingPackageScopes();
  if (state === "hydrating" || (state === "ready" && scopes.length === 0)) return null;
  return <Button variant="ghost" label={t.pendingTitle} onPress={() => go(PACKAGE_RECOVERY_ROUTE)} testID="pending-packages-link" />;
}

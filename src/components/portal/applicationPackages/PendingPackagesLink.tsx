"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { listApplicationPackagePendingScopes } from "@/lib/portal/application-packages-pending";
import type { ApplicationDocumentOwner } from "@/lib/portal/application-documents";
import { subscribePackagePending } from "./pending";

/**
 * Ссылка на «Незавершённые отправки» в обзоре поступления. Показываем её только
 * когда на этом устройстве действительно есть оборванное действие (или браузер не
 * даёт это проверить — тогда лучше показать, чем спрятать). Без неё студент не
 * видит лишнюю кнопку, которая ведёт на пустой экран.
 */
export function PendingPackagesLink({ owner, label }: Readonly<{ owner: ApplicationDocumentOwner; label: string }>) {
  const state = useSyncExternalStore(
    subscribePackagePending,
    () => {
      try { return listApplicationPackagePendingScopes(owner).length > 0 ? "pending" : "none"; } catch { return "blocked"; }
    },
    () => "hydrating",
  );
  if (state === "none" || state === "hydrating") return null;
  return <Link className="pt-btn-ghost" href="/portal/package-recovery">{label}</Link>;
}

// Неоконченные отправки комплекта программы как состояние экрана (веб: `usePackagePending`): записи программы, «заблокировано»,
// «прочитано». Перечитывается, когда хранилище сообщило об изменении.
import { useEffect, useState } from "react";

import type { ApplicationPackageSubmitIntent } from "@web/lib/portal/application-packages";

import { packagesPending, type PackageOperation } from "@/features/preparations/packages-pending";
import type { PendingEntry, PendingScope } from "@/features/preparations/pending-store";

export type PackagePendingView = Readonly<{
  hydrated: boolean;
  blocked: boolean;
  entries: readonly PendingEntry<PackageOperation, ApplicationPackageSubmitIntent>[];
}>;

export function usePackagePending(scope: PendingScope): PackagePendingView {
  const { organizationId, membershipId, studentCaseId, applicationId } = scope;
  const address = `${organizationId}:${membershipId}:${studentCaseId}:${applicationId}`;
  const [read, setRead] = useState<{ address: string; blocked: boolean; entries: PackagePendingView["entries"] } | null>(null);
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    const load = () => {
      const mine = ++sequence;
      packagesPending.list({ organizationId, membershipId, studentCaseId, applicationId }).then(
        (entries) => {
          if (alive && mine === sequence) setRead({ address, blocked: false, entries });
        },
        () => {
          if (alive && mine === sequence) setRead({ address, blocked: true, entries: [] });
        },
      );
    };
    load();
    const unsubscribe = packagesPending.subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [address, organizationId, membershipId, studentCaseId, applicationId]);
  return read && read.address === address ? { hydrated: true, blocked: read.blocked, entries: read.entries } : { hydrated: false, blocked: false, entries: [] };
}

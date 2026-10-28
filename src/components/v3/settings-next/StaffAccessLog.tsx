"use client";

import { ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { GuardedBody, useSheetGuard } from "@/components/v3/admin-next/SheetGuard";
import { sheetEscape } from "@/components/v3/panel/sheet-escape";
import { RequestRow } from "@/components/v3/settings/StaffSection";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import type { StaffAuthRequest } from "@/lib/v3/staff-workspace-contract";

/**
 * «Журнал доступа» — о созданных аккаунтах и приглашениях. Проверка сверяет результат с сервисом входа и ничего не отправляет повторно
 * (это за «?»). Строки — прежние (`RequestRow`): «Проверить результат» и подготовка доступа ожидающего. Пока проверка идёт или её итог
 * неизвестен, панель не закрывается (Esc и щелчок мимо): строка держит исходный запрос, а закрытая панель выбросила бы его.
 */
export function StaffAccessLog({ requests, roles, organizationId }: Readonly<{ requests: readonly StaffAuthRequest[]; roles: StaffRoleWorkspace; organizationId: string }>) {
  const [open, setOpen] = useState(false);
  const guard = useSheetGuard();
  return (
    <DetailSheet
      onEscapeKeyDown={sheetEscape}
      title="Журнал доступа"
      description={`Запросов: ${requests.length}`}
      help="Проверка сверяет результат с сервисом входа и ничего не отправляет повторно."
      trigger={<Button variant="outline"><ScrollTextIcon aria-hidden="true" />Журнал доступа · {requests.length}</Button>}
      open={open}
      onOpenChange={(next) => { if (next) setOpen(true); else if (guard.allowClose()) setOpen(false); }}
    >
      <GuardedBody guard={guard}>
        {requests.length
          ? <ul>{requests.map((request) => <RequestRow key={request.requestId} request={request} workspace={roles} organizationId={organizationId} />)}</ul>
          : <p className="t-body-compact text-fg-3">Запросов доступа пока нет.</p>}
      </GuardedBody>
    </DetailSheet>
  );
}

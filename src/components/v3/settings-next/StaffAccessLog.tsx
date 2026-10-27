"use client";

import { ScrollTextIcon } from "lucide-react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { RequestRow } from "@/components/v3/settings/StaffSection";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import type { StaffAuthRequest } from "@/lib/v3/staff-workspace-contract";

/**
 * «Журнал доступа» — о созданных аккаунтах и приглашениях. Проверка сверяет результат с сервисом входа и ничего не отправляет повторно
 * (это за «?»). Строки — прежние (`RequestRow`): «Проверить результат» и подготовка доступа ожидающего.
 */
export function StaffAccessLog({ requests, roles, organizationId }: Readonly<{ requests: readonly StaffAuthRequest[]; roles: StaffRoleWorkspace; organizationId: string }>) {
  return (
    <DetailSheet
      title="Журнал доступа"
      description={`Запросов: ${requests.length}`}
      help="Проверка сверяет результат с сервисом входа и ничего не отправляет повторно."
      trigger={<Button variant="outline"><ScrollTextIcon aria-hidden="true" />Журнал доступа · {requests.length}</Button>}
    >
      {requests.length
        ? <ul>{requests.map((request) => <RequestRow key={request.requestId} request={request} workspace={roles} organizationId={organizationId} />)}</ul>
        : <p className="t-body-compact text-fg-3">Запросов доступа пока нет.</p>}
    </DetailSheet>
  );
}

"use client";

import { MailPlusIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { GuardedBody, useSheetGuard } from "@/components/staff/admin-next/SheetGuard";
import { sheetEscape } from "@/components/staff/panel/sheet-escape";
import { StaffInviteForm, StaffPasswordForm } from "@/components/staff/settings/StaffInviteForm";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";

type Panel = "invite" | "account";
const TITLE: Readonly<Record<Panel, string>> = { invite: "Пригласить сотрудника", account: "Создать аккаунт" };
const ICON = { invite: MailPlusIcon, account: UserPlusIcon } as const;

/**
 * Одна кнопка и её выезжающая панель (25.11.2026): форма раскрывалась прямо в строке кнопок, строка вырастала, а «Журнал доступа» уезжал
 * на середину её высоты. Теперь строка кнопок не меняется. Панель под охраной (`useSheetGuard`): пока запрос не завершён или его итог
 * неизвестен, она не закрывается (Esc, щелчок мимо, крестик) — исходный запрос с тем же request_id остаётся; введённое без отправки
 * закрывается только после вопроса. Одноразовый пароль после создания — тоже поле формы: закрыть панель с ним можно только после вопроса.
 */
function NewAccessSheet({ panel, roles, organizationId }: Readonly<{ panel: Panel; roles: StaffRoleWorkspace; organizationId: string }>) {
  const [open, setOpen] = useState(false);
  const guard = useSheetGuard();
  const Icon = ICON[panel];
  return (
    <DetailSheet
      onEscapeKeyDown={sheetEscape}
      title={TITLE[panel]}
      trigger={<Button variant="outline"><Icon aria-hidden="true" />{TITLE[panel]}</Button>}
      open={open}
      onOpenChange={(next) => { if (next) setOpen(true); else if (guard.allowClose()) setOpen(false); }}
    >
      <GuardedBody guard={guard}>
        <div data-testid={`v3-staff-new-${panel}`}>
          {panel === "invite" ? <StaffInviteForm workspace={roles} organizationId={organizationId} bare /> : <StaffPasswordForm workspace={roles} organizationId={organizationId} bare />}
        </div>
      </GuardedBody>
    </DetailSheet>
  );
}

/** «Пригласить сотрудника» и «Создать аккаунт» — кнопки в строке раздела «Сотрудники»; форма каждой — в своей панели. */
export function StaffNewAccess({ roles, organizationId }: Readonly<{ roles: StaffRoleWorkspace; organizationId: string }>) {
  return (
    <div className="flex flex-wrap gap-2">
      <NewAccessSheet panel="invite" roles={roles} organizationId={organizationId} />
      <NewAccessSheet panel="account" roles={roles} organizationId={organizationId} />
    </div>
  );
}

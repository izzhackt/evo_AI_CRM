"use client";

import { MailPlusIcon, UserPlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { StaffInviteForm, StaffPasswordForm } from "@/components/v3/settings/StaffInviteForm";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";

type Panel = "invite" | "account";
const TITLE: Readonly<Record<Panel, string>> = { invite: "Пригласить сотрудника", account: "Создать аккаунт" };

/**
 * «Пригласить сотрудника» и «Создать аккаунт»: кнопки раскрывают форму на странице под собой, а не в панели. У создания аккаунта есть одноразовый
 * пароль, который показывается один раз, — случайное закрытие по щелчку мимо его потеряло бы; форма закрывается только своей кнопкой.
 */
export function StaffNewAccess({ roles, organizationId }: Readonly<{ roles: StaffRoleWorkspace; organizationId: string }>) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const regionId = useId();
  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-expanded={panel === "invite"} aria-controls={panel === "invite" ? regionId : undefined} onClick={() => toggle("invite")}><MailPlusIcon aria-hidden="true" />{TITLE.invite}</Button>
        <Button variant="outline" aria-expanded={panel === "account"} aria-controls={panel === "account" ? regionId : undefined} onClick={() => toggle("account")}><UserPlusIcon aria-hidden="true" />{TITLE.account}</Button>
      </div>
      {panel ? (
        <div id={regionId}>
          <WidgetCard title={TITLE[panel]} headingLevel={3} actions={<Button variant="ghost" onClick={() => setPanel(null)}>Закрыть</Button>}>
            {panel === "invite" ? <StaffInviteForm workspace={roles} organizationId={organizationId} /> : <StaffPasswordForm workspace={roles} organizationId={organizationId} />}
          </WidgetCard>
        </div>
      ) : null}
    </div>
  );
}

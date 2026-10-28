"use client";

import { MailPlusIcon, UserPlusIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { StaffInviteForm, StaffPasswordForm } from "@/components/v3/settings/StaffInviteForm";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";

type Panel = "invite" | "account";
const TITLE: Readonly<Record<Panel, string>> = { invite: "Пригласить сотрудника", account: "Создать аккаунт" };
const PANELS: readonly Panel[] = ["invite", "account"];

/**
 * «Пригласить сотрудника» и «Создать аккаунт»: кнопки раскрывают форму на странице под собой, а не в панели. У создания аккаунта есть одноразовый
 * пароль, который показывается один раз, а у приглашения с неизвестным итогом — исходный запрос, который проверяют тем же request_id. Оба живут
 * только в смонтированной форме, поэтому формы стоят на странице всегда, а «закрыть» и выбор соседней только прячут (`hidden`), как прячет
 * `StaffDisclosure` прежнего вида: щелчок по соседней кнопке не теряет пароль. «Закрыть» возвращает фокус на кнопку, что открыла форму.
 */
export function StaffNewAccess({ roles, organizationId }: Readonly<{ roles: StaffRoleWorkspace; organizationId: string }>) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const regionId = useId();
  const buttons = { invite: useRef<HTMLButtonElement>(null), account: useRef<HTMLButtonElement>(null) };
  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));
  const close = () => {
    const opener = panel;
    setPanel(null);
    if (opener) buttons[opener].current?.focus();
  };
  const icons = { invite: MailPlusIcon, account: UserPlusIcon };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {PANELS.map((key) => {
          const Icon = icons[key];
          return (
            <Button key={key} ref={buttons[key]} variant="outline" aria-expanded={panel === key} aria-controls={`${regionId}-${key}`} onClick={() => toggle(key)}>
              <Icon aria-hidden="true" />{TITLE[key]}
            </Button>
          );
        })}
      </div>
      {PANELS.map((key) => (
        <div key={key} id={`${regionId}-${key}`} data-testid={`v3-staff-new-${key}`} hidden={panel !== key}>
          <WidgetCard title={TITLE[key]} headingLevel={3} actions={<Button variant="ghost" onClick={close}>Закрыть</Button>}>
            {key === "invite" ? <StaffInviteForm workspace={roles} organizationId={organizationId} /> : <StaffPasswordForm workspace={roles} organizationId={organizationId} />}
          </WidgetCard>
        </div>
      ))}
    </div>
  );
}

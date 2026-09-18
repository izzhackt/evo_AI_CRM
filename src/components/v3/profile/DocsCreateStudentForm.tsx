"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { createDocsStudentAction, type DocsStudentActionState } from "@/lib/platform-docs-student-actions";

type Curator = Readonly<{ membershipId: string; displayName: string }>;
const MESSAGES: Record<DocsStudentActionState["status"], string> = {
  idle: "",
  invalid: "Проверьте имя студента, куратора и страну.",
  denied: "Нет доступа к созданию студента или выбранному куратору. Попросите администратора проверить права.",
  request_conflict: "Этот запрос уже использован с другими данными. Сначала проверьте список студентов.",
  unavailable: "Результат пока не подтверждён. Ваш ввод сохранён; повторите тот же запрос или проверьте список студентов.",
};

export function DocsCreateStudentForm({ requestId, curators, defaultCuratorMembershipId }: Readonly<{
  requestId: string; curators: readonly Curator[]; defaultCuratorMembershipId: string | null;
}>) {
  const [displayName, setDisplayName] = useState("");
  const [curatorId, setCuratorId] = useState(defaultCuratorMembershipId ?? "");
  const [country, setCountry] = useState("");
  const [state, action, pending] = useActionState(createDocsStudentAction, { status: "idle", requestId } as DocsStudentActionState);
  const uncertain = state.status === "unavailable";
  const stopped = state.status === "denied" || state.status === "request_conflict";
  const locked = pending || uncertain || stopped;

  return <form action={action} aria-busy={pending} className="max-w-xl space-y-6" data-testid="docs-create-student-form">
    <input type="hidden" name="request_id" value={state.requestId} />
    <input type="hidden" name="display_name" value={displayName} />
    <input type="hidden" name="curator_membership_id" value={curatorId} />
    <input type="hidden" name="target_country" value={country} />
    <fieldset disabled={locked} className="space-y-5">
      <label className="block"><span className={labelCls}>Имя и фамилия студента</span>
        <input required maxLength={200} autoComplete="off" value={displayName} onChange={event => setDisplayName(event.target.value)} className={`${inputCls} min-h-11 w-full`} />
      </label>
      <label className="block"><span className={labelCls}>Куратор</span>
        <select required value={curatorId} onChange={event => setCuratorId(event.target.value)} className={`${inputCls} min-h-11 w-full`}>
          <option value="">Выберите куратора</option>
          {curators.map(curator => <option key={curator.membershipId} value={curator.membershipId}>{curator.displayName}</option>)}
        </select>
      </label>
      <label className="block"><span className={labelCls}>Страна поступления — необязательно</span>
        <input maxLength={100} value={country} onChange={event => setCountry(event.target.value)} list="docs-student-countries" autoComplete="off" className={`${inputCls} min-h-11 w-full`} />
        <datalist id="docs-student-countries"><option value="Китай" /><option value="Малайзия" /><option value="ОАЭ" /><option value="Турция" /></datalist>
      </label>
    </fieldset>
    {state.status !== "idle" ? <p role="alert" className="text-sm leading-6 text-fg-2">{MESSAGES[state.status]}</p> : null}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={pending || stopped || curators.length === 0} className={`${btnCls} min-h-11`}>
        {pending ? "Добавляем…" : uncertain ? "Повторить тот же запрос" : "Добавить студента"}
      </button>
      <Link href="/v3/profile?section=docs" className={`${btnGhostCls} min-h-11`}>{uncertain || stopped ? "К списку студентов" : "Отмена"}</Link>
    </div>
  </form>;
}

"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { btnGhostCls, cn, fieldLabelCls, inputCls } from "@/components/ui";
import { createStudentCaseAccountAction } from "@/lib/student-account-actions";
import {
  studentAccountMessage,
  type CaseCabinetView,
  type StudentCaseAccountActionState,
} from "@/lib/student-account-contract";
import { studentLoginBase } from "@/lib/student-login";

import { CaseCabinetReset } from "./CaseCabinetReset";

const MESSAGES: Readonly<Record<Exclude<StudentCaseAccountActionState["status"], "idle" | "created" | "already_created">, string>> = {
  invalid: "Проверьте имя, фамилию и почту.",
  forbidden: "Кабинеты создаёт только администратор.",
  email_taken: "Аккаунт с этой почтой уже есть. Оставьте почту пустой или укажите другую.",
  unavailable: "Кабинет не создан. Повторите.",
  unconfirmed: "Ответ не пришёл: кабинет мог создаться. Обновите страницу и не создавайте его заново.",
  case_has_cabinet: "У студента уже есть кабинет.",
  case_closed: "Дело закрыто: кабинет не открывается.",
  case_invite_exists: "Студенту уже отправлено приглашение по почте: кабинет с временным паролем здесь не открыть.",
  case_unsupported: "Дело ждёт продажи: сначала сохраните продажу.",
};

/**
 * «Доступ к порталу → Кабинет с временным паролем» (343, 07.11.2026): кабинет сразу с этим делом. Логин и временный
 * пароль видны только здесь и один раз — CRM их не хранит, поэтому блок стоит на одном месте для формы, «Кабинет открыт»
 * и причины отказа: когда карточка обновится (заметка, задача), показанный пароль не пропадёт. Имя и фамилия — из анкеты
 * или имени дела, логин виден до создания: порядок в CRM бывает «Фамилия Имя». Открытый кабинет — «Сбросить пароль» (344).
 */
export function CaseCabinetAccount({ studentCaseId, requestId, firstName, lastName, portalOrigin, view, reset }: Readonly<{
  studentCaseId: string;
  requestId: string;
  firstName: string;
  lastName: string;
  portalOrigin: string;
  view: CaseCabinetView;
  reset: Readonly<{ requestId: string; login: string | null; email: string | null }>;
}>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createStudentCaseAccountAction, { status: "idle", requestId } as StudentCaseAccountActionState);
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const created = state.status === "created";

  // The card around shows the new state (summary, no e-mail invite); this block keeps the result it already has.
  useEffect(() => {
    if (created) router.refresh();
  }, [created, router]);

  if (state.status === "created") {
    const { account } = state;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(studentAccountMessage(account, portalOrigin));
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <div className="space-y-2 text-sm text-fg-2" data-testid="case-cabinet-created">
        <p role="alert" className="t-body-compact text-danger">Пароль виден только сейчас: отправьте его студенту.</p>
        <p>Логин: <span className="break-all font-mono text-fg">{account.login}</span></p>
        <p>Временный пароль: <span className="font-mono text-fg">{account.password}</span></p>
        <button type="button" className={cn(btnGhostCls, "min-h-11")} onClick={copy}>Скопировать сообщение для WhatsApp</button>
        <p role="status" aria-live="polite" className="t-meta">{copied ? "Сообщение скопировано." : ""}</p>
      </div>
    );
  }
  if (view === "open") return <CaseCabinetReset studentCaseId={studentCaseId} portalOrigin={portalOrigin} {...reset} />;
  if (view !== "form") return <p className="t-body-compact text-fg-2" data-testid="case-cabinet-refusal">{MESSAGES[view]}</p>;

  return (
    <form action={action} className="grid gap-3 text-sm text-fg-2 md:grid-cols-2" data-testid="case-cabinet-account">
      <p className="t-label text-fg md:col-span-2">Кабинет с временным паролем</p>
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <label className="block min-w-0">
        <span className={fieldLabelCls}>Имя</span>
        <input name="first_name" value={first} onChange={(event) => setFirst(event.target.value)} required maxLength={60}
          autoComplete="off" className={cn(inputCls, "min-h-11 w-full")} />
      </label>
      <label className="block min-w-0">
        <span className={fieldLabelCls}>Фамилия</span>
        <input name="last_name" value={last} onChange={(event) => setLast(event.target.value)} required maxLength={60}
          autoComplete="off" className={cn(inputCls, "min-h-11 w-full")} />
      </label>
      <label className="block min-w-0 md:col-span-2">
        <span className={fieldLabelCls}>Почта, если есть</span>
        <input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254}
          autoComplete="off" className={cn(inputCls, "min-h-11 w-full")} />
      </label>
      <p className="t-meta md:col-span-2">Логин: <span className="break-all font-mono text-fg">{studentLoginBase(first, last)}</span></p>
      <div className="md:col-span-2">
        <button type="submit" disabled={pending} className={cn(btnGhostCls, "min-h-11")}>{pending ? "Создаём…" : "Создать кабинет"}</button>
      </div>
      {state.status === "already_created" ? (
        <p role="alert" className="t-body-compact text-danger md:col-span-2">
          Этот кабинет уже создан: логин {state.login}. Пароль показывался один раз.
        </p>
      ) : state.status !== "idle" ? (
        <p role="alert" className="t-body-compact text-danger md:col-span-2">{MESSAGES[state.status]}</p>
      ) : null}
    </form>
  );
}

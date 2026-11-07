"use client";

import { useActionState, useState } from "react";

import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn, fieldLabelCls, inputCls } from "@/components/ui";
import { createStudentAccountAction } from "@/lib/student-account-actions";
import {
  studentAccountMessage,
  studentAccountsCsv,
  type StudentAccountActionState,
  type StudentAccountResult,
} from "@/lib/student-account-contract";

const MESSAGES: Readonly<Record<"invalid" | "forbidden" | "email_taken" | "unavailable", string>> = {
  invalid: "Проверьте имя, фамилию и почту.",
  forbidden: "Кабинеты создаёт только администратор.",
  email_taken: "Аккаунт с этой почтой уже есть. Оставьте почту пустой или укажите другую.",
  unavailable: "Кабинет не создан. Повторите.",
};

type Draft = Readonly<{ firstName: string; lastName: string; email: string }>;
type View = Readonly<{ state: StudentAccountActionState; created: readonly StudentAccountResult[]; draft: Draft }>;
const EMPTY: Draft = { firstName: "", lastName: "", email: "" };

// The list of created accounts lives only in this tab; the server action gets the request id, never the passwords back.
// React empties the form after every submit: a refusal puts the typed values back for correction, a created one does not.
async function createAndCollect(previous: View, form: FormData): Promise<View> {
  const state = await createStudentAccountAction({ status: "idle", requestId: previous.state.requestId }, form);
  if (state.status !== "created") {
    const typed = (key: string) => { const value = form.get(key); return typeof value === "string" ? value : ""; };
    return { ...previous, state, draft: { firstName: typed("first_name"), lastName: typed("last_name"), email: typed("email") } };
  }
  const known = previous.created.some((row) => row.login === state.account.login);
  return { state, created: known ? previous.created : [...previous.created, state.account], draft: EMPTY };
}

/**
 * «Кабинеты студентов» (342, решение 07.11.2026): кабинет с нуля — имя и фамилия, почта по желанию. Логин и временный
 * пароль видны только здесь, пока страница открыта: CRM их не хранит, поэтому сразу — таблица для рассылки.
 */
export function StudentAccountsNext({ requestId, portalOrigin }: Readonly<{ requestId: string; portalOrigin: string }>) {
  const [{ state, created, draft }, action, pending] = useActionState(createAndCollect, { state: { status: "idle", requestId }, created: [], draft: EMPTY });
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  }

  function download() {
    const blob = new Blob([studentAccountsCsv(created, portalOrigin)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `evo-kabinety-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-student-accounts">
      <WidgetCard headingLevel={3} title="Создать кабинет" bodyClassName="grid gap-3">
        <form action={action} className="grid gap-3 @2xl:grid-cols-3">
          <input type="hidden" name="request_id" value={state.requestId} />
          <label className="block min-w-0">
            <span className={fieldLabelCls}>Имя</span>
            <input name="first_name" defaultValue={draft.firstName} required maxLength={60} autoComplete="off" className={cn(inputCls, "min-h-11 w-full")} />
          </label>
          <label className="block min-w-0">
            <span className={fieldLabelCls}>Фамилия</span>
            <input name="last_name" defaultValue={draft.lastName} required maxLength={60} autoComplete="off" className={cn(inputCls, "min-h-11 w-full")} />
          </label>
          <label className="block min-w-0">
            <span className={fieldLabelCls}>Почта, если есть</span>
            <input name="email" type="email" defaultValue={draft.email} maxLength={254} autoComplete="off" className={cn(inputCls, "min-h-11 w-full")} />
          </label>
          <div className="@2xl:col-span-3">
            <Button type="submit" disabled={pending}>{pending ? "Создаём…" : "Создать кабинет"}</Button>
          </div>
        </form>
        {state.status === "already_created"
          ? <p role="alert" className="t-body-compact text-danger">Этот кабинет уже создан: логин {state.login}. Пароль показывался один раз.</p>
          : state.status !== "idle" && state.status !== "created"
            ? <p role="alert" className="t-body-compact text-danger">{MESSAGES[state.status]}</p> : null}
      </WidgetCard>

      {created.length > 0 ? (
        <WidgetCard headingLevel={3} title="Созданы сейчас" bodyClassName="grid gap-3">
          <p role="alert" className="t-body-compact text-danger">Скачайте таблицу до ухода со страницы: пароли больше нигде не сохраняются.</p>
          <ul className="grid gap-3" data-testid="student-accounts-created">
            {created.map((account) => (
              <li key={account.login} className="grid gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
                <span className="t-item text-fg">{account.lastName} {account.firstName}</span>
                <span className="t-body-compact text-fg-2">Логин: <span className="font-mono text-fg">{account.login}</span></span>
                <span className="t-body-compact text-fg-2">Временный пароль: <span className="font-mono text-fg">{account.password}</span></span>
                <span>
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(account.login, studentAccountMessage(account, portalOrigin))}>
                    Скопировать сообщение для WhatsApp
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <div><Button type="button" onClick={download}>Скачать таблицу (CSV)</Button></div>
          <p role="status" aria-live="polite" className="t-meta text-fg-2">{copied ? "Сообщение скопировано." : ""}</p>
        </WidgetCard>
      ) : null}
      <p className="t-meta text-fg-3">Студент входит по логину и временному паролю и сразу придумывает свой. Без почты он позже добавит её в профиле.</p>
    </div>
  );
}

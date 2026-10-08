"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { btnDangerGhostCls, btnGhostCls, cn } from "@/components/ui";
import { Pill } from "@/components/v3/Pill";
import {
  accountDeletionDate,
  type AccountDeletionReviewItem,
  type AccountDeletionReviewKind,
  type AccountDeletionReviewReason,
} from "@/lib/account-deletion-contract";
import {
  resolveAccountDeletionCandidateAction,
  type AccountDeletionReviewState,
} from "@/lib/account-deletion/staff-actions";
import { SALES_STAGE_TITLE } from "@/lib/v3/wording";

/**
 * «Проверить вручную» в карточке запроса на удаление (дополнение к 279 от
 * 08.10, правило владельца «удаляем только своё»). Записи вне собственных
 * данных аккаунта, где есть его телефон, email или номер паспорта, или
 * которыми пользуется ещё кто-то. Сами они не меняются: по каждой Admin
 * выбирает одно узкое действие для этой записи (с подтверждением тут же) или
 * «Не этот человек». Пока есть запись без решения, удалить аккаунт нельзя.
 */

const KIND: Readonly<Record<AccountDeletionReviewKind, string>> = {
  chat: "Чат WhatsApp",
  lead: "Лид",
  client: "Клиент",
  case: "Дело",
};

const REASON: Readonly<Record<AccountDeletionReviewReason, string>> = {
  phone: "тот же телефон",
  email: "тот же email",
  passport: "тот же номер паспорта",
  shared: "ею пользуется ещё другое дело, анкета или лид",
  linked: "чат связан и с этим человеком, и с записью другого человека",
};

const ERASE: Readonly<Record<AccountDeletionReviewKind, Readonly<{ action: string; confirm: string; done: string }>>> = {
  chat: {
    action: "Удалить этот чат",
    confirm: "Удалить этот чат со всеми сообщениями, файлами и данными ИИ? Отменить нельзя.",
    done: "Чат удалён",
  },
  lead: {
    action: "Обезличить этого лида",
    confirm: "Обезличить этого лида? Его заметки и квитанции заявки удалятся, имя в отчёте продаж заменится, лид уйдёт в архив. Отменить нельзя.",
    done: "Лид обезличен",
  },
  client: {
    action: "Обезличить этого клиента",
    confirm: "Обезличить этого клиента? Его имя, телефон и email удалятся. Отменить нельзя.",
    done: "Клиент обезличен",
  },
  case: {
    action: "Удалить данные этого дела",
    confirm: "Удалить документы, переписку и задачи этого дела, а само дело обезличить? Отменить нельзя.",
    done: "Данные дела удалены",
  },
};

const FAILED: Readonly<Record<Exclude<AccountDeletionReviewState["status"], "idle" | "done">, string>> = {
  failed: "Не получилось сохранить решение. Повторите.",
  gone: "Этой записи больше нет в списке. Обновите страницу.",
  has_account: "У этого дела свой аккаунт студента: удалить его можно только по его собственному запросу.",
  invalid: "Не получилось сохранить решение. Обновите страницу.",
  forbidden: "Решать может только администратор, не в режиме просмотра роли.",
};

const IDLE: AccountDeletionReviewState = { status: "idle" };

function hrefFor(item: AccountDeletionReviewItem): string | null {
  if (!item.exists) return null;
  if (item.kind === "chat") return `/v3/inbox?conversation=${item.id}`;
  if (item.kind === "lead") return `/v3/profile?id=${item.id}`;
  if (item.kind === "case") return `/v3/profile?case=${item.id}`;
  return item.facts.leadId ? `/v3/profile?id=${item.facts.leadId}` : null;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function factsLine(item: AccountDeletionReviewItem): string | null {
  const f = item.facts;
  const parts: string[] = [];
  if (item.kind === "chat") {
    if (typeof f.messages === "number") {
      parts.push(`${f.messages} ${plural(f.messages, "сообщение", "сообщения", "сообщений")}`);
    }
    if (f.lastMessageAt) parts.push(`последнее ${accountDeletionDate(f.lastMessageAt)}`);
    if (f.caseName) parts.push(`привязан к делу «${f.caseName}»`);
  } else if (item.kind === "lead") {
    const stage = f.stage && Object.hasOwn(SALES_STAGE_TITLE, f.stage)
      ? SALES_STAGE_TITLE[f.stage as keyof typeof SALES_STAGE_TITLE] : null;
    if (stage) parts.push(`этап «${stage}»`);
    if (f.lifecycle === "archived") parts.push("в архиве");
    if (f.createdAt) parts.push(`создан ${accountDeletionDate(f.createdAt)}`);
  } else if (item.kind === "client") {
    if (typeof f.leads === "number") parts.push(`лидов: ${f.leads}`);
    if (typeof f.cases === "number") parts.push(`дел: ${f.cases}`);
  } else if (item.kind === "case") {
    parts.push(f.hasAccount ? "есть свой аккаунт студента" : "кабинет без аккаунта студента");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function amocrmLine(item: AccountDeletionReviewItem): string | null {
  const parts = [
    item.amocrm.contactIds.length > 0 ? `контакт ${item.amocrm.contactIds.join(", ")}` : null,
    item.amocrm.leadIds.length > 0 ? `сделка ${item.amocrm.leadIds.join(", ")}` : null,
    item.amocrm.dispatchedCommands > 0 ? `команд без ответа: ${item.amocrm.dispatchedCommands}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `amoCRM: ${parts.join(", ")}` : null;
}

function DecisionForm({ requestRowId, item, decision, children, className }: Readonly<{
  requestRowId: string;
  item: AccountDeletionReviewItem;
  decision: "erase" | "not_subject";
  children: ReactNode;
  className?: string;
}>) {
  return (
    <>
      <input type="hidden" name="request_row_id" value={requestRowId} />
      <input type="hidden" name="kind" value={item.kind} />
      <input type="hidden" name="item_id" value={item.id} />
      <input type="hidden" name="decision" value={decision} />
      <div className={className}>{children}</div>
    </>
  );
}

function ReviewRow({ requestRowId, item, editable }: Readonly<{
  requestRowId: string;
  item: AccountDeletionReviewItem;
  editable: boolean;
}>) {
  const [eraseState, eraseAction, erasing] = useActionState(resolveAccountDeletionCandidateAction, IDLE);
  const [keepState, keepAction, keeping] = useActionState(resolveAccountDeletionCandidateAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  const startRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirmId = useId();
  const pending = erasing || keeping;
  const state = eraseState.status !== "idle" ? eraseState : keepState;
  const error = state.status !== "idle" && state.status !== "done" ? FAILED[state.status] : null;
  const words = ERASE[item.kind];
  const href = hrefFor(item);
  const facts = factsLine(item);
  const amocrm = amocrmLine(item);

  // After a successful decision the page re-reads the list and this row shows
  // the decision; after a failure the confirmation stays with the error.
  useEffect(() => { if (confirming) confirmRef.current?.focus(); }, [confirming]);

  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0" data-review-kind={item.kind}
      data-review-id={item.id} data-review-decision={item.decision ?? "open"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words">
          <span className="t-caption me-2 text-fg-2">{KIND[item.kind]}</span>
          {href ? (
            <Link href={href} className="t-item text-fg underline underline-offset-4 hover:text-fg-2">
              {item.title ?? "Без имени"}
            </Link>
          ) : (
            <span className="t-item text-fg">{item.title ?? (item.exists ? "Без имени" : "Запись удалена")}</span>
          )}
        </p>
        {item.decision === "erased" ? (
          <Pill tone="ok">{words.done}</Pill>
        ) : item.decision === "not_subject" ? (
          <Pill tone="neutral">Не этот человек</Pill>
        ) : (
          <Pill tone="warn">нужно решение</Pill>
        )}
      </div>
      <p className="t-body-compact text-fg-2">
        Почему в списке: {item.reasons.map((reason) => REASON[reason]).join("; ")}.
      </p>
      {facts || amocrm ? (
        <p className="t-meta text-fg-2">{[facts, amocrm].filter(Boolean).join(" · ")}</p>
      ) : null}
      {item.decision && item.decidedAt ? (
        <p className="t-meta text-fg-2">
          Решение <time dateTime={item.decidedAt} className="font-mono tabular-nums">{accountDeletionDate(item.decidedAt)}</time>
          {item.decidedBy ? `, ${item.decidedBy}` : ""}
        </p>
      ) : null}

      {editable && item.decision !== "erased" ? (
        confirming ? (
          <form action={eraseAction} aria-busy={erasing} className="flex flex-col gap-2 rounded-ctl border border-border px-3 py-3">
            <p id={confirmId} className="t-body-compact text-fg">{words.confirm}</p>
            <DecisionForm requestRowId={requestRowId} item={item} decision="erase"
              className="flex flex-col-reverse gap-2 sm:flex-row">
              <button type="button" className={cn(btnGhostCls, "whitespace-nowrap")} disabled={erasing}
                onClick={() => { setConfirming(false); requestAnimationFrame(() => startRef.current?.focus()); }}>
                Отмена
              </button>
              <button ref={confirmRef} type="submit" aria-describedby={confirmId}
                className={cn(btnDangerGhostCls, "whitespace-nowrap")} disabled={erasing}
                data-testid="v3-deletion-review-confirm">
                {erasing ? "Сохраняем…" : words.action}
              </button>
            </DecisionForm>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {item.canErase ? (
              <button ref={startRef} type="button" className={cn(btnDangerGhostCls, "whitespace-nowrap")} disabled={pending}
                onClick={() => setConfirming(true)} data-testid="v3-deletion-review-erase">
                {words.action}
              </button>
            ) : null}
            {item.decision === null ? (
              <form action={keepAction} aria-busy={keeping}>
                <DecisionForm requestRowId={requestRowId} item={item} decision="not_subject">
                  <button type="submit" className={cn(btnGhostCls, "whitespace-nowrap")} disabled={pending}
                    data-testid="v3-deletion-review-keep">
                    {keeping ? "Сохраняем…" : "Не этот человек"}
                  </button>
                </DecisionForm>
              </form>
            ) : null}
          </div>
        )
      ) : null}
      {editable && item.kind === "case" && !item.canErase && item.decision === null ? (
        <p className="t-meta text-fg-2">У дела свой аккаунт студента: удалить его можно только по его собственному запросу.</p>
      ) : null}
      {error ? <p role="alert" className="t-body-compact text-danger">{error}</p> : null}
    </li>
  );
}

export function AccountDeletionReview({ requestRowId, items, open, editable }: Readonly<{
  requestRowId: string;
  items: readonly AccountDeletionReviewItem[];
  open: number;
  editable: boolean;
}>) {
  return (
    <section className="rounded-card border border-border bg-surface px-4 py-4" data-testid="v3-deletion-review"
      aria-labelledby="v3-deletion-review-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="v3-deletion-review-title" className="t-section text-fg">Проверить вручную</h3>
        {items.length > 0 ? (
          <p className="t-body-compact text-fg-2" data-testid="v3-deletion-review-open">
            {open > 0 ? `Без решения: ${open} из ${items.length}` : "По всем записям есть решение"}
          </p>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="t-body-compact mt-1 text-fg-2">
          Других записей с его телефоном, email или номером паспорта нет.
        </p>
      ) : (
        <>
          <p className="t-body-compact mt-1 max-w-[70ch] text-fg-2">
            В этих записях есть его телефон, email или номер паспорта, но они не связаны с его аккаунтом или ими
            пользуется кто-то ещё. Сами они не изменятся. Откройте запись, решите по каждой: удалить или обезличить
            только её, или «Не этот человек».{editable && open > 0 ? " Пока есть записи без решения, удалить аккаунт нельзя." : ""}
          </p>
          <ul className="mt-2 flex flex-col">
            {items.map((item) => (
              <ReviewRow key={`${item.kind}:${item.id}`} requestRowId={requestRowId} item={item} editable={editable} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

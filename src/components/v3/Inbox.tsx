"use client";

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";

/**
 * Входящие: список диалогов слева, переписка справа.
 *
 * Главное, что этот экран обязан показать честно: исходящих сообщений в базе
 * нет ни одного. Людям написали — им не ответили. Поэтому здесь нет «нашего»
 * пузыря справа и нет работающего поля ответа: WAHA не подключена, отправлять
 * нечем, и кнопка «отправить», которая молча ничего не делает, была бы враньём.
 * Поле есть, оно выключено, и рядом написана причина.
 *
 * Когда WAHA подключат, меняется источник и `canSend`, а не раскладка.
 */

export type InboxMessage = Readonly<{
  id: string;
  inbound: boolean;
  body: string;
  /** «30.08 09:14». null — времени нет. */
  at: string | null;
}>;

export type InboxThread = Readonly<{
  id: string;
  person: string;
  channel: string;
  status: string;
  role: string;
  /** Стадия лида, если диалог к нему привязан. */
  stage: string | null;
  leadHref: string | null;
  messages: readonly InboxMessage[];
}>;

export function Inbox({
  threads,
  canSend,
  cannotSendReason,
}: {
  threads: readonly InboxThread[];
  canSend: boolean;
  cannotSendReason: string;
}) {
  const [openId, setOpenId] = useState<string | null>(threads[0]?.id ?? null);
  const open = threads.find((t) => t.id === openId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      {/* ---- Список диалогов ---- */}
      <section
        aria-label="Диалоги"
        // На узком экране открытая переписка занимает всё: две колонки по
        // 190px — это не два списка, а два обрубка.
        className={`min-w-0 overflow-hidden rounded-card border border-border bg-surface ${
          open ? "hidden lg:block" : ""
        }`}
      >
        <ul>
          {threads.map((thread) => {
            const last = thread.messages[thread.messages.length - 1];
            const active = thread.id === openId;
            return (
              <li key={thread.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setOpenId(thread.id)}
                  className={`flex w-full flex-col gap-1 px-4 py-3 text-start ${
                    active ? "bg-surface-2" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                      {thread.person}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-fg-3">{last?.at ?? ""}</span>
                  </span>
                  <span className="line-clamp-2 text-2xs leading-4 text-fg-3">
                    {last?.body ?? "нет сообщений"}
                  </span>
                  <span className="flex flex-wrap gap-1 pt-0.5">
                    <Pill>{thread.channel}</Pill>
                    <Pill>{thread.role}</Pill>
                    {thread.messages.length > 1 ? (
                      <Pill>{thread.messages.length} сообщения</Pill>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
          {threads.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-fg-3">Диалогов нет.</li>
          ) : null}
        </ul>
      </section>

      {/* ---- Переписка ---- */}
      {open ? (
        <section
          aria-label={`Переписка: ${open.person}`}
          className="flex min-w-0 flex-col rounded-card border border-border bg-surface"
        >
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="-ms-1 grid h-8 w-8 shrink-0 place-items-center rounded-nav text-fg-2 hover:bg-surface-2 lg:hidden"
            >
              <span className="sr-only">Назад к списку диалогов</span>
              <Icon name="arrow-left" size={16} />
            </button>

            <h3 className="min-w-0 flex-1 truncate text-md font-bold text-fg">{open.person}</h3>

            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
              {open.stage ? <Pill tone="info">{open.stage}</Pill> : null}
              <Pill tone={open.status === "open" ? "ok" : "neutral"}>{open.status}</Pill>
            </span>

            {open.leadHref ? (
              <Link
                href={open.leadHref}
                prefetch={false}
                className="inline-flex min-h-6 shrink-0 items-center text-xs text-fg-2 underline decoration-border-strong underline-offset-4 hover:decoration-fg-2"
              >
                Открыть профиль
              </Link>
            ) : null}
          </header>

          <div
            role="group"
            aria-label="Сообщения"
            tabIndex={0}
            className="flex max-h-[520px] min-h-[240px] flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4"
          >
            {open.messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[min(560px,88%)] rounded-ctl px-3 py-2 ${
                  message.inbound
                    ? "self-start border border-border bg-surface-2"
                    : "self-end bg-accent text-on-accent"
                }`}
              >
                <p className={`text-sm leading-5 ${message.inbound ? "text-fg" : "text-on-accent"}`}>
                  {message.body}
                </p>
                {message.at ? (
                  <p
                    className={`mt-1 font-mono text-2xs ${
                      message.inbound ? "text-fg-3" : "text-on-accent"
                    }`}
                  >
                    {message.at}
                  </p>
                ) : null}
              </article>
            ))}

            {open.messages.every((m) => m.inbound) ? (
              <p className="mt-1 self-center px-2 text-center text-2xs leading-4 text-fg-3">
                Ответов нет: все сообщения в этом диалоге — входящие.
              </p>
            ) : null}
          </div>

          <footer className="border-t border-border px-4 py-3">
            <div className="flex items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Ответ</span>
                <textarea
                  rows={2}
                  disabled={!canSend}
                  placeholder={canSend ? "Ответить" : "Отправка недоступна"}
                  className="w-full resize-none rounded-ctl border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-3 disabled:bg-surface-2"
                />
              </label>
              <button
                type="button"
                disabled={!canSend}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-accent text-on-accent disabled:bg-surface-3 disabled:text-fg-3"
              >
                <span className="sr-only">Отправить</span>
                <Icon name="send" size={16} />
              </button>
            </div>
            {!canSend ? (
              <p className="mt-2 text-2xs leading-4 text-fg-3">{cannotSendReason}</p>
            ) : null}
          </footer>
        </section>
      ) : (
        <section className="hidden place-items-center rounded-card border border-border bg-surface p-8 text-sm text-fg-3 lg:grid">
          Выберите диалог слева.
        </section>
      )}
    </div>
  );
}

import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listConversationsForActor } from "@/lib/queries";
import { createConversationAction } from "@/lib/actions";
import type { WhatsAppAccessActor } from "@/lib/whatsapp-policy";
import { EmptyState, inputCls, btnCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  getConversationStatePresentation,
  type OperationalTone,
} from "@/components/platform/communications/whatsapp-state";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function stateClassName(tone: OperationalTone) {
  return {
    neutral: "bg-surface-3 text-fg-2",
    info: "bg-info-weak text-info",
    ok: "bg-ok-weak text-ok",
    warning: "bg-warn-weak text-warn",
    danger: "bg-danger-weak text-danger",
  }[tone];
}

export async function WaList({
  actor,
  activeId,
}: {
  actor: WhatsAppAccessActor;
  activeId?: number;
}) {
  const { t } = await getT();
  const { full: conversations, summaries } = listConversationsForActor(actor);
  const hasRows = conversations.length > 0 || summaries.length > 0;

  return (
    <aside className="flex w-full flex-col border-border md:w-[336px] md:shrink-0 md:border-r">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="text-[14px] font-semibold text-fg">{t("inbox")}</span>
        {actor.role === "admin" && (
          <details id="add" className="relative scroll-mt-24">
            <summary className={cn(btnCls, "h-9 cursor-pointer list-none px-3")}>
              <Icon name="plus" size={15} /> {t("newConversation")}
            </summary>
            <form
              action={createConversationAction}
              className="absolute right-0 z-20 mt-2 w-72 space-y-2 rounded-card border border-border bg-surface p-4 shadow-evo-lg"
            >
              <label htmlFor="wa-new-phone" className="sr-only">
                {t("phone")}
              </label>
              <input
                id="wa-new-phone"
                name="phone"
                required
                inputMode="tel"
                autoComplete="tel"
                placeholder="+996 ___ ___ ___"
                className={inputCls}
              />
              <label htmlFor="wa-new-name" className="sr-only">
                {t("name")}
              </label>
              <input
                id="wa-new-name"
                name="name"
                autoComplete="name"
                placeholder={t("name")}
                className={inputCls}
              />
              <button type="submit" className={cn(btnCls, "w-full")}>{t("add")}</button>
            </form>
          </details>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasRows ? (
          <EmptyState text={t("noResults")} />
        ) : (
          <ul>
            {conversations.map((c) => {
              const active = c.id === activeId;
              const displayName = c.name ?? c.phone;
              const state = getConversationStatePresentation(c.agent_state);
              const unreadLabel =
                c.unread > 0 ? `, ${c.unread} ${t("unreadMessages")}` : "";
              return (
                <li key={c.id}>
                  <Link
                    href={`/whatsapp/${c.id}`}
                    aria-current={active ? "page" : undefined}
                    aria-label={`${t("conversationLinkLabel")}: ${displayName}${unreadLabel}`}
                    className={cn(
                      "flex items-center gap-3 border-b border-border px-4 py-3 transition-[background-color]",
                      active ? "bg-accent-weak" : "hover:bg-surface-2",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ok-weak text-[12px] font-semibold text-ok"
                    >
                      {initials(displayName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-[13.5px] font-semibold", active ? "text-accent" : "text-fg")}>
                          {displayName}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-fg-3">{c.last_message_at ?? ""}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] text-fg-3">
                          {c.account_name ? `${c.account_name}: ` : ""}{c.last_text ?? "—"}
                        </span>
                        {c.unread > 0 && (
                          <span
                            aria-hidden="true"
                            className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-ok px-1.5 text-[10px] font-bold text-on-accent"
                          >
                            {c.unread}
                          </span>
                        )}
                      </div>
                      {state && (
                        <span
                          className={cn(
                            "mt-1 inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            stateClassName(state.tone),
                          )}
                        >
                          {t(state.labelKey)}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
            {summaries.map((summary) => {
              const caseState = t(`caseState.${summary.case_state}`);
              const fields = [
                {
                  key: "case-id",
                  label: t("client"),
                  value: `#${summary.id}`,
                },
                {
                  key: "student-name",
                  label: t("name"),
                  value: summary.name,
                },
                {
                  key: "target-country",
                  label: t("country"),
                  value: summary.target_country ?? "—",
                },
                {
                  key: "target-degree",
                  label: t("degree"),
                  value: summary.target_degree ?? "—",
                },
                {
                  key: "case-state",
                  label: t("caseState"),
                  value: caseState,
                },
                {
                  key: "curator-name",
                  label: t("curator"),
                  value: summary.curator_name ?? t("notAssigned"),
                },
                {
                  key: "handoff-at",
                  label: t("handoffAt"),
                  value: summary.handoff_at ?? "—",
                },
              ] as const;

              return (
                <li
                  key={`case-${summary.id}`}
                  data-testid="whatsapp-handoff-summary"
                  data-case-id={summary.id}
                  className="border-b border-border bg-info-weak px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-info-weak text-[12px] font-semibold text-info"
                    >
                      {initials(summary.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-fg">
                        {summary.name}
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium text-info">
                        {t("salesHandoffSummaryTitle")}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-info-weak px-2 py-0.5 text-[10px] font-semibold text-info">
                      {caseState}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2">
                    {fields.map((field) => (
                      <div
                        key={field.key}
                        data-summary-field={field.key}
                        className={cn(
                          "min-w-0 rounded-ctl bg-surface px-2.5 py-2",
                          field.key === "handoff-at" && "col-span-2",
                        )}
                      >
                        <dt className="truncate text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
                          {field.label}
                        </dt>
                        <dd className="mt-0.5 truncate text-[11.5px] font-semibold text-fg">
                          {field.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

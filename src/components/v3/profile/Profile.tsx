import Link from "next/link";

import { Pill } from "@/components/v3/Pill";
import { personState } from "@/lib/v3/wording";

import { Anketa, Documents, History, Money, Overview } from "./tabs";
import { TABS, type PersonProfile, type ProfileDraft, type TabKey } from "./types";

/**
 * Профиль человека — один на всех, лид он или уже студент.
 *
 * Вкладки, а не одна длинная страница: полей около сорока, и на одном полотне
 * они превращаются в свалку. У каждого поля есть очевидный ящик, и вкладку
 * можно наполнять годами, не переверстывая экран.
 *
 * ВКЛАДКИ — ССЫЛКИ, А НЕ ВИДЖЕТ. Адрес несёт `?tab=`, поэтому вкладку можно
 * переслать, вернуться назад кнопкой браузера и открыть без JavaScript. Роли
 * `tablist`/`tab` здесь были бы неправдой: это переходы по страницам, и
 * читалка должна назвать их ссылками. Текущая помечена `aria-current`.
 *
 * «Файлы» отдельной вкладкой нет намеренно: она перечисляла бы те же файлы,
 * что уже стоят в строках чеклиста документов. Файл живёт при своём пункте.
 *
 * Обзор — маршрутизатор, а не сводка всего: он говорит, что с человеком
 * сейчас и куда идти, но не повторяет содержимое вкладок.
 */
export function Profile({
  profile,
  draft,
  tab,
  hrefFor,
}: {
  profile: PersonProfile;
  /** Образец: этих полей в модели пока нет. */
  draft: ProfileDraft;
  tab: TabKey;
  hrefFor: (tab: string) => string;
}) {
  const state = personState({
    hasCase: profile.student,
    caseStatus: profile.caseStatus,
    leadStage: profile.stage,
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="min-w-0 text-xl font-semibold tracking-[-0.02em] text-fg">
          {profile.person}
        </h2>
        <p className="text-sm text-fg-3">{state}</p>
        {profile.financeStop ? (
          <Pill tone="danger">финансовый стоп</Pill>
        ) : null}
      </header>

      {/* Полоса вкладок прокручивается на узком экране: пять названий не
          помещаются в 393px, а переносить их в две строки — терять шапку. */}
      <nav
        aria-label="Разделы профиля"
        tabIndex={0}
        className="max-w-full overflow-x-auto border-b border-border"
      >
        <ul className="flex w-max gap-1">
          {TABS.map((entry) => {
            const active = entry.key === tab;
            return (
              <li key={entry.key}>
                <Link
                  href={hrefFor(entry.key)}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-10 items-center whitespace-nowrap border-b-2 px-3 text-sm ${
                    active
                      ? "border-accent font-semibold text-fg"
                      : "border-transparent text-fg-3 hover:text-fg-2"
                  }`}
                >
                  {entry.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {tab === "overview" ? (
        <Overview profile={profile} draft={draft} tabHref={hrefFor} />
      ) : null}
      {tab === "anketa" ? <Anketa profile={profile} draft={draft} /> : null}
      {tab === "documents" ? <Documents draft={draft} /> : null}
      {tab === "money" ? <Money profile={profile} draft={draft} /> : null}
      {tab === "history" ? <History profile={profile} /> : null}
    </div>
  );
}

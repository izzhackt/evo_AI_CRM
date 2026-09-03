import Link from "next/link";

import { PartShell } from "@/components/v3/PartShell";
import { Profile } from "@/components/v3/profile/Profile";
import { isTabKey } from "@/components/v3/profile/types";
import { readProfile, readProfilePicks } from "@/lib/v3/profile-source";

import { PROFILE_SAMPLE, PROFILE_SAMPLE_EARLY } from "./sample";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Профиль" };

export default async function ProfilePart({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; tab?: string }>;
}) {
  const [params, picks] = await Promise.all([searchParams, readProfilePicks()]);

  // Открывается ЛЮБОЙ запрошенный человек, а не только тот, что попал в
  // короткий список-леса. Раньше неизвестный id молча подменялся на picks[0]:
  // сотрудник нажимал на «Ахмеда» и получал карточку «Айгерим» — её
  // документы, её деньги, — и на экране не было ни одного признака подмены.
  // Промолчать здесь хуже, чем показать «не нашли».
  const requestedId = params.id ?? picks[0]?.id ?? null;
  const profile = requestedId ? await readProfile(requestedId) : null;
  const chosenId = profile ? requestedId : null;
  const missing = Boolean(params.id) && !profile;
  const tab = isTabKey(params.tab) ? params.tab : "overview";

  // У того, кто ещё не дошёл до договора, платежей и половины анкеты нет.
  // Это не пустое состояние-заглушка, а нормальная стадия.
  const draft = profile?.student ? PROFILE_SAMPLE : PROFILE_SAMPLE_EARLY;
  const hrefFor = (next: string) =>
    `/v3/profile?id=${chosenId ?? ""}&tab=${next}`;

  return (
    <PartShell
      title="Профиль"
      lead="Одна страница на человека: сначала лид, потом тот же человек — студент. Вкладки — обычные ссылки, поэтому их можно переслать и вернуться назад кнопкой браузера."
    >
      {/*
        Переключатель — леса прототипа, а не элемент продукта. В продукте на
        профиль приходят из очереди или из поиска.
      */}
      <nav aria-label="Чей профиль показать" className="mb-5">
        <p className="mb-1.5 text-2xs uppercase tracking-wide text-fg-3">
          Показать профиль · леса прототипа
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {picks.map((pick) => {
            const active = chosenId === pick.id;
            return (
              <li key={pick.id}>
                <Link
                  href={`/v3/profile?id=${pick.id}&tab=${tab}`}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-nav border px-2.5 text-xs ${
                    active
                      ? "border-accent bg-accent text-on-accent"
                      : "border-border bg-surface text-fg-2 hover:border-control-edge"
                  }`}
                >
                  {pick.name}
                  <span className={active ? "text-on-accent" : "text-fg-3"}>
                    {pick.student ? "студент" : "лид"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {profile ? (
        <>
          <Profile profile={profile} draft={draft} tab={tab} hrefFor={hrefFor} />
          <p className="mt-5 max-w-[62ch] text-2xs leading-4 text-fg-3">
            Подчёркнутое пунктиром — то, чего в модели EVO ещё нет: анкета,
            план платежей, типы документов, ответственный. Их около тридцати из
            сорока. Нарисованы, чтобы обсуждать раскладку; работать они начнут,
            когда появятся в схеме.
          </p>
        </>
      ) : (
        <p className="rounded-card border border-border bg-surface px-4 py-8 text-center text-sm text-fg-3">
          {missing
            ? "Такого человека в базе нет. Показывать вместо него другого мы не будем."
            : "В базе нет ни одного человека."}
        </p>
      )}
    </PartShell>
  );
}

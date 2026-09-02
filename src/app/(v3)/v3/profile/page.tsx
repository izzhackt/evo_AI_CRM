import Link from "next/link";

import { PartShell } from "@/components/v3/PartShell";
import { Profile } from "@/components/v3/Profile";
import { readProfile, readProfilePicks } from "@/lib/v3/profile-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Профиль" };

export default async function ProfilePart({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const [{ id }, picks] = await Promise.all([searchParams, readProfilePicks()]);
  const chosen = picks.find((p) => p.id === id) ?? picks[0];
  const profile = chosen ? await readProfile(chosen.id) : null;

  return (
    <PartShell
      title="Профиль"
      lead="Одна страница на человека. Пока он лид — блоков про заявку и визу нет; когда становится студентом, они появляются, а продажная часть сворачивается в «Как он к нам пришёл»."
    >
      {/*
        Переключатель — леса прототипа, а не элемент продукта. В продукте на
        профиль приходят из очереди или из поиска, и выбирать человека прямо на
        его странице незачем. Здесь он нужен, чтобы вы могли посмотреть обе
        стадии, не заводя вторую страницу.
      */}
      <nav aria-label="Чей профиль показать" className="mb-5">
        <p className="mb-1.5 text-2xs uppercase tracking-wide text-fg-3">
          Показать профиль · леса прототипа
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {picks.map((pick) => {
            const active = chosen?.id === pick.id;
            return (
              <li key={pick.id}>
                <Link
                  href={`/v3/profile?id=${pick.id}`}
                  aria-current={active ? "page" : undefined}
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
        <Profile profile={profile} />
      ) : (
        <p className="rounded-card border border-border bg-surface px-4 py-8 text-center text-sm text-fg-3">
          В базе нет ни одного человека.
        </p>
      )}
    </PartShell>
  );
}

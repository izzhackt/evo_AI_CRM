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
    >

      {profile ? (
        <>
          <Profile profile={profile} draft={draft} tab={tab} hrefFor={hrefFor} />
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

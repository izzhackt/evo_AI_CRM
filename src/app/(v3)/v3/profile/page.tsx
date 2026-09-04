import { randomUUID } from "node:crypto";

import { PartShell } from "@/components/v3/PartShell";
import { Profile } from "@/components/v3/profile/Profile";
import { resolveTab } from "@/components/v3/profile/types";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import { readProfile, readProfilePicks } from "@/lib/v3/profile-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Профиль" };

export default async function ProfilePart({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; tab?: string }>;
}) {
  const actor = await requirePlatformSalesActor();
  if (actor.authorityRole !== "admin" && actor.authorityRole !== "sales") {
    throw new Error("Sales profile resolved a non-Sales staff role.");
  }
  const [params, picks] = await Promise.all([
    searchParams,
    readProfilePicks(actor),
  ]);

  // Открывается ЛЮБОЙ запрошенный человек, а не только тот, что попал в
  // короткий список-леса. Раньше неизвестный id молча подменялся на picks[0]:
  // сотрудник нажимал на «Ахмеда» и получал карточку «Айгерим» — её
  // документы, её деньги, — и на экране не было ни одного признака подмены.
  // Промолчать здесь хуже, чем показать «не нашли».
  const requestedId = params.id ?? picks[0]?.id ?? null;
  const view = requestedId ? await readProfile(actor, requestedId) : null;
  const chosenId = view ? requestedId : null;
  const missing = Boolean(params.id) && !view;
  // Вкладка приходит адресом, поэтому её нельзя брать на веру: чужое слово и
  // вкладка, которой у этого человека нет (`?tab=documents` у лида), открывают
  // обзор.
  const tab = resolveTab(params.tab, Boolean(view?.profile.student));
  const hrefFor = (next: string) =>
    `/v3/profile?id=${chosenId ?? ""}&tab=${next}`;
  const requestIds = {
    contract: randomUUID(),
    firstPayment: randomUUID(),
    override: randomUUID(),
    handoff: randomUUID(),
  };

  return (
    <PartShell title="Профиль">
      {view ? (
        <Profile
          profile={view.profile}
          draft={view.details}
          sales={view.sales}
          actorRole={actor.authorityRole}
          requestIds={requestIds}
          tab={tab}
          hrefFor={hrefFor}
        />
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

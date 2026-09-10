import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { UniversityContentView, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { UniversityEditor, UniversityReviewForm } from "@/components/v3/universities/UniversityEditor";
import { requireV3PageActor } from "@/lib/platform-guards";
import { universityUuid, type UniversityContent } from "@/lib/platform-university-catalog";
import { readStaffUniversities, readUniversityDrafts, reviewedUniversityTemplates } from "@/lib/v3/university-source";
export const dynamic = "force-dynamic";
const link = "inline-flex min-h-11 items-center rounded-ctl border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2";
type Params = Record<string, string | string[] | undefined>;
export default async function UniversityManagePage({ searchParams }: { searchParams: Promise<Params> }) {
  const [actor, params] = await Promise.all([requireV3PageActor("/v3/universities"), searchParams]);
  if (actor.authorityRole !== "admin" || actor.presentationRole !== "admin") redirect("/access-denied?from=%2Fv3%2Funiversities");
  if (Object.keys(params).length > 1 || Object.entries(params).some(([key, value]) => !["draft", "edit", "template", "new"].includes(key) || typeof value !== "string")) notFound();
  const draftId = params.draft === undefined ? null : universityUuid(params.draft) ?? notFound();
  const editId = params.edit === undefined ? null : universityUuid(params.edit) ?? notFound();
  if (params.new !== undefined && params.new !== "1") notFound();
  const today = new Date().toISOString().slice(0, 10);
  const back = <Link className={`${link} mb-5`} href="/v3/universities/manage">← Управление каталогом</Link>;
  if (draftId) {
    let drafts;
    try { drafts = await readUniversityDrafts(actor, draftId); } catch { return <PartShell title="Проверка карточки"><UniversityUnavailable /></PartShell>; }
    const draft = drafts[0] ?? notFound();
    return <PartShell title={`Проверка: ${draft.content.name}`}>{back}<p className="mb-5 text-sm leading-6 text-fg-2">Это черновик на основе версии {draft.baseVersion}. Студенты его не видят. Причина: {draft.reason}</p><UniversityContentView content={draft.content} now={new Date()} /><div className="mt-6"><UniversityReviewForm draftId={draft.id} requestId={randomUUID()} /></div></PartShell>;
  }
  const templates = reviewedUniversityTemplates();
  if (params.template !== undefined || editId || params.new === "1") {
    let content: UniversityContent, version = 0;
    if (editId) {
      let page;
      try { page = await readStaffUniversities(actor, undefined, editId); } catch { return <PartShell title="Обновление карточки"><UniversityUnavailable /></PartShell>; }
      const university = page.items[0] ?? notFound(); content = university.content; version = university.version;
    } else if (params.template !== undefined) content = templates.find((item) => item.key === params.template)?.content ?? notFound();
    else content = { name: "", country: "CN", city: null, overview: "", websiteUrl: "", sourceUrl: "", verifiedOn: today, notes: "", photoKey: null, programs: [{ id: "program-1", title: "", level: "bachelor", duration: null, language: null, summary: "", sourceUrl: "", intakes: [] }] };
    return <PartShell title={editId ? "Новая версия карточки" : "Подготовка карточки"}>{back}<UniversityEditor content={content} institutionId={editId} baseVersion={version} requestId={randomUUID()} today={today} /></PartShell>;
  }
  let drafts;
  try { drafts = await readUniversityDrafts(actor); } catch { return <PartShell title="Управление каталогом"><UniversityUnavailable /></PartShell>; }
  return <PartShell title="Управление каталогом"><div className="space-y-7"><Link className={link} href="/v3/universities">← Опубликованный каталог</Link><p className="max-w-3xl text-sm leading-6 text-fg-2">Сначала сохраните сведения на проверку, затем откройте предпросмотр и подтвердите публикацию. Только действующий Admin может выполнить эти действия. Проверенная карточка создаёт или использует запись в существующем справочнике университетов.</p><section><h2 className="text-lg font-semibold text-fg">На проверке ({drafts.length}{drafts.length === 50 ? "+" : ""})</h2>{drafts.length ? <ul className="mt-3 divide-y divide-border rounded-card border border-border bg-surface">{drafts.map((draft) => <li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium text-fg">{draft.content.name}</p><p className="mt-1 text-xs text-fg-3">На основе опубликованной версии {draft.baseVersion}</p></div><Link className={link} href={`/v3/universities/manage?draft=${draft.id}`}>Проверить</Link></li>)}</ul> : <p className="mt-2 text-sm text-fg-3">Новых черновиков нет.</p>}</section><section><h2 className="text-lg font-semibold text-fg">Подготовленные сведения из открытых источников</h2><p className="mt-2 text-sm leading-6 text-fg-2">Это исходные материалы для вашей проверки, а не автоматически опубликованные записи. Они не означают партнёрство с EVO. Для уже опубликованного вуза используйте «Предложить обновление» в его карточке.</p><ul className="mt-3 grid gap-3 sm:grid-cols-2">{templates.map((item) => <li key={item.key}><Link className={`${link} w-full`} href={`/v3/universities/manage?template=${item.key}`}>{item.content.name}</Link></li>)}</ul></section><Link className={link} href="/v3/universities/manage?new=1">Добавить другой университет</Link></div></PartShell>;
}

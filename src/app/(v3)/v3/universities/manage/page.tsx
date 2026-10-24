import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { PartShell } from "@/components/v3/PartShell";
import { QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { UniversityContentView, UniversityUnavailable, universityCountry } from "@/components/v3/universities/UniversityCatalogue";
import { UniversityEditor, UniversityIntakeIdentityForm, UniversityReviewForm } from "@/components/v3/universities/UniversityEditor";
import { UniversityBatchReview } from "@/components/v3/universities/UniversityBatchReview";
import { universityBatchRows } from "@/lib/server/university-catalog-batch";
import { requireV3PageActor } from "@/lib/platform-guards";
import { withUniversityIntakeIds, type UniversityContent } from "@/lib/platform-university-catalog";
import { readStaffUniversities, readUniversityDrafts, readUniversityManageDraftPage, readUniversityBatchSnapshot, reviewedUniversityTemplates } from "@/lib/v3/university-source";
import { parseManageRoute, parseManageListContext, manageListHref, manageListContext, manageEditorHref } from "@/lib/university-manage-contract";
export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };
// Серверная страница: классы кнопок — свои строки (клиентские модули отдают серверу ссылки, не строки).
const link = QUEUE_SECONDARY;
const PRIMARY_LINK = "v3-raised inline-flex h-11 items-center justify-center gap-1.5 rounded-ctl border border-accent bg-accent px-4 t-label text-on-accent hover:border-accent-2 hover:bg-accent-2";
const BACK = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4";
const NOTE = "t-body-compact text-fg-2";
type Params = Record<string, string | string[] | undefined>;
export default async function UniversityManagePage({ searchParams }: { searchParams: Promise<Params> }) {
  const [actor, params] = await Promise.all([requireV3PageActor("/v3/universities"), searchParams]);
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.import.manage")) redirect("/access-denied?from=%2Fv3%2Funiversities");
  const route = parseManageRoute(Object.entries(params)) ?? notFound();
  const mode = route.kind === "editor" ? route.mode : null;
  const value = route.kind === "editor" ? route.value : null;
  const listContext = route.kind === "editor" ? route.listContext : manageListContext(route.index);
  const listIndex = parseManageListContext(listContext) ?? { q: "", cursor: null };
  const draftId = mode === "draft" ? value : null;
  const editId = mode === "edit" ? value : null;
  const identifyId = mode === "identify" ? value : null;
  const today = new Date().toISOString().slice(0, 10);
  const back = <Link className={BACK} href={manageListHref(listIndex)}><Icon name="arrow-left" size={16} />Управление каталогом</Link>;
  if (draftId) {
    let drafts;
    try { drafts = await readUniversityDrafts(actor, draftId); } catch { return <PartShell title="Проверка карточки"><UniversityUnavailable /></PartShell>; }
    const draft = drafts[0];
    if (!draft) return <PartShell title="Проверка карточки" back={back}><p role="status" className={`mb-4 ${NOTE}`}>Черновик уже обработан или недоступен. Не создавайте дубликат: проверьте опубликованный каталог.</p><Link className={link} href="/v3/universities">Открыть опубликованный каталог</Link></PartShell>;
    return <PartShell title={`Проверка: ${draft.content.name}`} back={back}><p className={`mb-5 ${NOTE}`}>{draft.reviewKind === "intake_ids" ? "Технический черновик" : "Черновик"} на основе версии {draft.baseVersion}. Студенты его не видят. Причина: {draft.reason}</p><UniversityContentView content={draft.content} now={new Date()} /><div className="mt-6"><UniversityReviewForm draftId={draft.id} requestId={randomUUID()} reviewKind={draft.reviewKind} /></div></PartShell>;
  }
  const templates = reviewedUniversityTemplates();
  if (mode === "batch") {
    let rows;
    try { rows = universityBatchRows(templates, await readUniversityBatchSnapshot(actor)); }
    catch { return <PartShell title="Публикация подготовленного каталога" back={back}><UniversityUnavailable /></PartShell>; }
    return <PartShell title="Публикация подготовленного каталога" back={back}><UniversityBatchReview initialRows={rows} /></PartShell>;
  }
  if (mode === "template" || editId || identifyId || mode === "new") {
    let content: UniversityContent, version = 0;
    if (editId || identifyId) {
      let page;
      try { page = await readStaffUniversities(actor, undefined, editId ?? identifyId); } catch { return <PartShell title="Обновление карточки"><UniversityUnavailable /></PartShell>; }
      const university = page.items[0] ?? notFound(); content = university.content; version = university.version;
    } else if (mode === "template") content = templates.find((item) => item.key === value)?.content ?? notFound();
    else content = { name: "", country: "CN", city: null, overview: "", websiteUrl: "", sourceUrl: "", verifiedOn: today, notes: "", photoKey: null, programs: [{ id: "program-1", title: "", level: "bachelor", duration: null, language: null, summary: "", sourceUrl: "", intakes: [] }] };
    const missingIds = content.programs.reduce((total, program) => total + program.intakes.filter((intake) => intake.id === undefined).length, 0);
    // Generate once on the server, then preserve the seed through edits and exact retries.
    const identifiedContent = withUniversityIntakeIds(content, randomUUID);
    if (identifyId) return <PartShell title={`Идентификаторы наборов: ${content.name}`} back={back}>{missingIds === 0 ? <p role="status" className={NOTE}>У всех наборов идентификаторы уже есть: техническая версия не нужна.</p> : <div className="space-y-6">
      <p className={`max-w-3xl ${NOTE}`}>Добавим постоянные идентификаторы {missingIds} {missingIds % 10 === 1 && missingIds % 100 !== 11 ? "набору" : "наборам"} из опубликованной версии {version}. Сведения и даты не меняются.</p>
      <UniversityContentView content={content} now={new Date()} />
      <UniversityIntakeIdentityForm content={identifiedContent} listContext={listContext} institutionId={identifyId} baseVersion={version} requestId={randomUUID()} />
    </div>}</PartShell>;
    return <PartShell title={editId ? "Новая версия карточки" : "Подготовка карточки"} back={back}>{editId && missingIds > 0 ? <p className={`mb-5 max-w-3xl ${NOTE}`}>Если сведения остаются прежними, можно <Link className="text-accent-text underline underline-offset-4" href={manageEditorHref("identify", editId, listContext)}>добавить идентификаторы наборов без изменения карточки</Link>.</p> : null}<UniversityEditor listContext={listContext} content={identifiedContent} institutionId={editId} baseVersion={version} requestId={randomUUID()} today={today} /></PartShell>;
  }
  if (route.kind !== "index") notFound();
  const { index } = route;
  let page: Awaited<ReturnType<typeof readUniversityManageDraftPage>> | null = null;
  try { page = await readUniversityManageDraftPage(actor, index); } catch { /* Keep navigation and templates available; never treat a failed read as an empty queue. */ }
  const matchingTemplates = templates.filter((item) => item.content.name.toLowerCase().includes(index.q.toLowerCase()));
  // Подготовленные материалы — по странам, свёрнутыми группами: стена из 125 равных кнопок не читалась. Поиск раскрывает совпавшие группы.
  const byCountry = new Map<string, typeof matchingTemplates>();
  for (const item of matchingTemplates) byCountry.set(item.content.country, [...(byCountry.get(item.content.country) ?? []), item]);
  const groups = [...byCountry]
    .map(([code, items]) => ({ code, label: universityCountry(code), items: [...items].sort((a, b) => a.content.name.localeCompare(b.content.name, "en")) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  const paged = Boolean(index.cursor || page?.nextCursor);
  return <PartShell title="Управление каталогом" back={<Link className={BACK} href="/v3/universities"><Icon name="arrow-left" size={16} />Все университеты</Link>} action={<Link className={PRIMARY_LINK} href={manageEditorHref("new", "1", listContext)}>Добавить университет</Link>}>
    <div className="min-w-0 space-y-7">
      <form action="/v3/universities/manage" method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64"><label htmlFor="manage-university-query" className="block t-label text-fg-2">Название университета</label><input key={index.q} id="manage-university-query" name="q" type="search" defaultValue={index.q} maxLength={200} className="mt-1 h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg" /></div>
        <button type="submit" className={link}>Найти</button>
        {index.q || index.cursor ? <Link className={link} href="/v3/universities/manage">Сбросить</Link> : null}
      </form>
      <section aria-labelledby="manage-pending-heading">
        <h2 id="manage-pending-heading" className="t-section text-fg">На проверке</h2>
        {page === null ? <div role="alert" className="mt-2"><p className="t-body-compact text-danger">Не удалось загрузить черновики. Обновите страницу, чтобы повторить загрузку.</p></div> : <>
          {page.items.length ? <ul className="mt-2 divide-y divide-border border-y border-border">{page.items.map((draft) => <li key={draft.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"><div className="min-w-0 break-words"><p className="t-item text-fg">{draft.content.name}</p><p className="t-meta text-fg-2">На основе опубликованной версии {draft.baseVersion}</p></div><Link className={link} href={manageEditorHref("draft", draft.id, listContext)}>Проверить</Link></li>)}</ul> : <p role="status" className={`mt-2 ${NOTE}`}>{index.q ? "Черновиков с таким названием нет." : index.cursor ? "На этой странице черновиков нет." : "Нет черновиков."}</p>}
          {paged ? <nav aria-label="Страницы черновиков" className="mt-3 flex flex-wrap gap-3">{index.cursor ? <Link className={link} href={manageListHref({ q: index.q, cursor: null })}>К началу списка</Link> : null}{page.nextCursor ? <Link className={link} href={manageListHref({ q: index.q, cursor: page.nextCursor })}>Следующие черновики</Link> : null}</nav> : null}
        </>}
      </section>
      <section aria-labelledby="manage-templates-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="manage-templates-heading" className="t-section text-fg">Подготовленные сведения из открытых источников</h2><Link className={link} href={manageEditorHref("batch", "1", listContext)}>Проверить и опубликовать пакет</Link></div>
        <p className={`mt-2 max-w-3xl ${NOTE}`}>Исходные материалы для проверки, не опубликованные записи; они не означают партнёрство с EVO. Для опубликованного вуза: «Предложить обновление» в его карточке.</p>
        {groups.length ? <div className="mt-3 border-y border-border" data-testid="manage-template-groups">{groups.map((group) => <details key={group.code} open={Boolean(index.q)} className="group border-b border-border last:border-b-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 t-item text-fg [&::-webkit-details-marker]:hidden"><Icon name="chevron-right" size={16} className="shrink-0 text-fg-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" />{group.label}<span className="t-body-compact tabular-nums text-fg-3">{group.items.length}</span></summary>
          <ul className="divide-y divide-border ps-6">{group.items.map((item) => <li key={item.key} className="min-w-0"><Link className="flex min-h-11 items-center justify-between gap-3 break-words t-body-compact text-fg hover:underline hover:underline-offset-4" href={manageEditorHref("template", item.key, listContext)}>{item.content.name}<span className="shrink-0 t-label text-fg-2">Подготовить</span></Link></li>)}</ul>
        </details>)}</div> : <p role="status" className={`mt-3 ${NOTE}`}>Подготовленных материалов с таким названием нет.</p>}
      </section>
    </div>
  </PartShell>;
}

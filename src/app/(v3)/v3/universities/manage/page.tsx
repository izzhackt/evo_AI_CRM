import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { UniversityContentView, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { UniversityEditor, UniversityIntakeIdentityForm, UniversityReviewForm } from "@/components/v3/universities/UniversityEditor";
import { UniversityBatchReview } from "@/components/v3/universities/UniversityBatchReview";
import { universityBatchRows } from "@/lib/server/university-catalog-batch";
import { requireV3PageActor } from "@/lib/platform-guards";
import { withUniversityIntakeIds, type UniversityContent } from "@/lib/platform-university-catalog";
import { readStaffUniversities, readUniversityDrafts, readUniversityManageDraftPage, readUniversityBatchSnapshot, reviewedUniversityTemplates } from "@/lib/v3/university-source";
import { parseManageRoute, parseManageListContext, manageListHref, manageListContext, manageEditorHref } from "@/lib/university-manage-contract";
export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };
const link = "inline-flex min-h-11 items-center rounded-ctl border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2";
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
  const back = <Link className={`${link} mb-5`} href={manageListHref(listIndex)}>← Управление каталогом</Link>;
  if (draftId) {
    let drafts;
    try { drafts = await readUniversityDrafts(actor, draftId); } catch { return <PartShell title="Проверка карточки"><UniversityUnavailable /></PartShell>; }
    const draft = drafts[0];
    if (!draft) return <PartShell title="Проверка карточки">{back}<p role="status" className="mb-5 text-sm leading-6 text-fg-2">Этот черновик больше не ожидает проверки или недоступен. Если решение уже было сохранено, не создавайте дубликат — проверьте опубликованный каталог.</p><Link className={link} href="/v3/universities">Открыть опубликованный каталог</Link></PartShell>;
    return <PartShell title={`Проверка: ${draft.content.name}`}>{back}<p className="mb-5 text-sm leading-6 text-fg-2">Это {draft.reviewKind === "intake_ids" ? "технический черновик" : "черновик"} на основе версии {draft.baseVersion}. Студенты его не видят. Причина: {draft.reason}</p><UniversityContentView content={draft.content} now={new Date()} /><div className="mt-6"><UniversityReviewForm draftId={draft.id} requestId={randomUUID()} reviewKind={draft.reviewKind} /></div></PartShell>;
  }
  const templates = reviewedUniversityTemplates();
  if (mode === "batch") {
    let rows;
    try { rows = universityBatchRows(templates, await readUniversityBatchSnapshot(actor)); }
    catch { return <PartShell title="Публикация подготовленного каталога">{back}<UniversityUnavailable /></PartShell>; }
    return <PartShell title="Публикация подготовленного каталога">{back}<UniversityBatchReview initialRows={rows} /></PartShell>;
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
    if (identifyId) return <PartShell title={`Закрепление наборов: ${content.name}`}>{back}{missingIds === 0 ? <p role="status" className="text-sm leading-6 text-fg-2">Нет наборов, которым нужно добавить идентификатор. Техническая версия не требуется.</p> : <div className="space-y-6">
      <p className="max-w-3xl text-sm leading-6 text-fg-2">Добавим постоянные идентификаторы {missingIds} {missingIds % 10 === 1 && missingIds % 100 !== 11 ? "набору" : "наборам"} из опубликованной версии {version}. Это позволит сохранять их связь при обновлении карточки. Названия, сроки и даты проверки источников останутся прежними. Новую проверку источников эта операция не подтверждает.</p>
      <UniversityContentView content={content} now={new Date()} />
      <UniversityIntakeIdentityForm content={identifiedContent} listContext={listContext} institutionId={identifyId} baseVersion={version} requestId={randomUUID()} />
    </div>}</PartShell>;
    return <PartShell title={editId ? "Новая версия карточки" : "Подготовка карточки"}>{back}{editId && missingIds > 0 ? <p className="mb-5 max-w-3xl text-sm leading-6 text-fg-2">Если сведения остаются прежними, можно <Link className="text-accent underline underline-offset-4" href={manageEditorHref("identify", editId, listContext)}>закрепить наборы без изменения карточки</Link>. Для изменения сроков и других сведений используйте форму ниже.</p> : null}<UniversityEditor listContext={listContext} content={identifiedContent} institutionId={editId} baseVersion={version} requestId={randomUUID()} today={today} /></PartShell>;
  }
  if (route.kind !== "index") notFound();
  const { index } = route;
  let page: Awaited<ReturnType<typeof readUniversityManageDraftPage>> | null = null;
  try { page = await readUniversityManageDraftPage(actor, index); } catch { /* Keep navigation and templates available; never treat a failed read as an empty queue. */ }
  const matchingTemplates = templates.filter((item) => item.content.name.toLowerCase().includes(index.q.toLowerCase()));
  return <PartShell title="Управление каталогом" action={<Link className="inline-flex min-h-11 items-center justify-center rounded-ctl border border-accent bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent/90" href={manageEditorHref("new", "1", listContext)}>Добавить университет</Link>}>
    <div className="min-w-0 space-y-7">
      <Link className={link} href="/v3/universities">← Опубликованный каталог</Link>
      <form action="/v3/universities/manage" method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64"><label htmlFor="manage-university-query" className="block text-sm font-medium text-fg">Название университета</label><input key={index.q} id="manage-university-query" name="q" type="search" defaultValue={index.q} maxLength={200} className="mt-1 min-h-11 w-full rounded-ctl border border-border bg-surface px-3 py-2 text-sm text-fg" /></div>
        <button type="submit" className={link}>Найти</button>
        {index.q || index.cursor ? <Link className={link} href="/v3/universities/manage">Сбросить</Link> : null}
      </form>
      <section aria-labelledby="manage-pending-heading">
        <h2 id="manage-pending-heading" className="text-lg font-semibold text-fg">На проверке</h2>
        {page === null ? <div role="alert" className="mt-3"><p className="text-sm text-danger">Не удалось загрузить черновики. Обновите страницу, чтобы повторить загрузку.</p></div> : <>
          <p className="mt-2 text-sm text-fg-3">На этой странице: {page.items.length}</p>
          {page.items.length ? <ul className="mt-3 divide-y divide-border rounded-card border border-border bg-surface">{page.items.map((draft) => <li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0 break-words"><p className="font-medium text-fg">{draft.content.name}</p><p className="mt-1 text-xs text-fg-3">На основе опубликованной версии {draft.baseVersion}</p></div><Link className={link} href={manageEditorHref("draft", draft.id, listContext)}>Проверить</Link></li>)}</ul> : <p role="status" className="mt-2 text-sm text-fg-3">{index.q ? "Черновиков с таким названием не найдено." : index.cursor ? "На этой странице черновиков нет." : "Новых черновиков нет."}</p>}
          {index.cursor || page.nextCursor ? <nav aria-label="Страницы черновиков" className="mt-3 flex flex-wrap gap-3">{index.cursor ? <Link className={link} href={manageListHref({ q: index.q, cursor: null })}>К началу списка</Link> : null}{page.nextCursor ? <Link className={link} href={manageListHref({ q: index.q, cursor: page.nextCursor })}>Следующие черновики</Link> : null}</nav> : null}
        </>}
      </section>
      <section aria-labelledby="manage-templates-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="manage-templates-heading" className="text-lg font-semibold text-fg">Подготовленные сведения из открытых источников</h2><Link className={link} href={manageEditorHref("batch", "1", listContext)}>Проверить и опубликовать пакет</Link></div>
        <p className="mt-2 text-sm leading-6 text-fg-2">Это исходные материалы для вашей проверки, а не автоматически опубликованные записи. Они не означают партнёрство с EVO. Для уже опубликованного вуза используйте «Предложить обновление» в его карточке.</p>
        {matchingTemplates.length ? <ul className="mt-3 grid gap-3 sm:grid-cols-2">{matchingTemplates.map((item) => <li key={item.key} className="min-w-0"><Link className={`${link} w-full break-words`} href={manageEditorHref("template", item.key, listContext)}>{item.content.name}</Link></li>)}</ul> : <p role="status" className="mt-3 text-sm text-fg-3">Подготовленных материалов с таким названием не найдено.</p>}
      </section>
    </div>
  </PartShell>;
}

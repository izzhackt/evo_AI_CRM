import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { UniversityShell } from "@/components/staff/universities-next/UniversityShell";
import { ManageIndexNextLazy } from "@/components/staff/universities-next/UniversitiesNextLazy";
import { manageIndexProps } from "@/components/staff/universities-next/manage-index-model";
import { QUEUE_SECONDARY } from "@/components/staff/queue/queue-buttons";
import { UniversityContentView, UniversityUnavailable, universityCountry } from "@/components/staff/universities/UniversityCatalogue";
import { UniversityEditor, UniversityIntakeIdentityForm, UniversityReviewForm } from "@/components/staff/universities/UniversityEditor";
import { UniversityBatchReview } from "@/components/staff/universities/UniversityBatchReview";
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
  const [actor, params] = await Promise.all([requireV3PageActor("/universities"), searchParams]);
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.import.manage")) redirect("/access-denied?from=%2Funiversities");
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
    try { drafts = await readUniversityDrafts(actor, draftId); } catch { return <UniversityShell title="Проверка карточки"><UniversityUnavailable /></UniversityShell>; }
    const draft = drafts[0];
    if (!draft) return <UniversityShell title="Проверка карточки" back={back}><p role="status" className={`mb-4 ${NOTE}`}>Черновик уже обработан или недоступен. Не создавайте дубликат: проверьте опубликованный каталог.</p><Link className={link} href="/universities">Открыть опубликованный каталог</Link></UniversityShell>;
    return <UniversityShell title={`Проверка: ${draft.content.name}`} back={back}><p className={`mb-5 ${NOTE}`}>{draft.reviewKind === "intake_ids" ? "Технический черновик" : "Черновик"} на основе версии {draft.baseVersion}. Студенты его не видят. Причина: {draft.reason}</p><UniversityContentView content={draft.content} now={new Date()} /><div className="mt-6"><UniversityReviewForm draftId={draft.id} requestId={randomUUID()} reviewKind={draft.reviewKind} /></div></UniversityShell>;
  }
  const templates = reviewedUniversityTemplates();
  if (mode === "batch") {
    let rows;
    try { rows = universityBatchRows(templates, await readUniversityBatchSnapshot(actor)); }
    catch { return <UniversityShell title="Публикация подготовленного каталога" back={back}><UniversityUnavailable /></UniversityShell>; }
    return <UniversityShell title="Публикация подготовленного каталога" back={back}><UniversityBatchReview initialRows={rows} /></UniversityShell>;
  }
  if (mode === "template" || editId || identifyId || mode === "new") {
    let content: UniversityContent, version = 0;
    if (editId || identifyId) {
      let page;
      try { page = await readStaffUniversities(actor, undefined, editId ?? identifyId); } catch { return <UniversityShell title="Обновление карточки"><UniversityUnavailable /></UniversityShell>; }
      const university = page.items[0] ?? notFound(); content = university.content; version = university.version;
    } else if (mode === "template") content = templates.find((item) => item.key === value)?.content ?? notFound();
    else content = { name: "", country: "CN", city: null, overview: "", websiteUrl: "", sourceUrl: "", verifiedOn: today, notes: "", photoKey: null, programs: [{ id: "program-1", title: "", level: "bachelor", duration: null, language: null, summary: "", sourceUrl: "", intakes: [] }] };
    const missingIds = content.programs.reduce((total, program) => total + program.intakes.filter((intake) => intake.id === undefined).length, 0);
    // Generate once on the server, then preserve the seed through edits and exact retries.
    const identifiedContent = withUniversityIntakeIds(content, randomUUID);
    if (identifyId) return <UniversityShell title={`Идентификаторы наборов: ${content.name}`} back={back}>{missingIds === 0 ? <p role="status" className={NOTE}>У всех наборов идентификаторы уже есть: техническая версия не нужна.</p> : <div className="space-y-6">
      <p className={`max-w-3xl ${NOTE}`}>Добавим постоянные идентификаторы {missingIds} {missingIds % 10 === 1 && missingIds % 100 !== 11 ? "набору" : "наборам"} из опубликованной версии {version}. Сведения и даты не меняются.</p>
      <UniversityContentView content={content} now={new Date()} />
      <UniversityIntakeIdentityForm content={identifiedContent} listContext={listContext} institutionId={identifyId} baseVersion={version} requestId={randomUUID()} />
    </div>}</UniversityShell>;
    return <UniversityShell title={editId ? "Новая версия карточки" : "Подготовка карточки"} back={back}>{editId && missingIds > 0 ? <p className={`mb-5 max-w-3xl ${NOTE}`}>Если сведения остаются прежними, можно <Link className="text-accent-text underline underline-offset-4" href={manageEditorHref("identify", editId, listContext)}>добавить идентификаторы наборов без изменения карточки</Link>.</p> : null}<UniversityEditor listContext={listContext} content={identifiedContent} institutionId={editId} baseVersion={version} requestId={randomUUID()} today={today} /></UniversityShell>;
  }
  if (route.kind !== "index") notFound();
  const { index } = route;
  let page: Awaited<ReturnType<typeof readUniversityManageDraftPage>> | null = null;
  try { page = await readUniversityManageDraftPage(actor, index); } catch { /* Keep navigation and templates available; never treat a failed read as an empty queue. */ }
  return <UniversityShell title="Управление каталогом" back={<Link className={BACK} href="/universities"><Icon name="arrow-left" size={16} />Все университеты</Link>} action={<Link className={PRIMARY_LINK} href={manageEditorHref("new", "1", listContext)}>Добавить университет</Link>}>
    <ManageIndexNextLazy {...manageIndexProps({ index, page, templates, countryLabel: universityCountry })} />
  </UniversityShell>;
}

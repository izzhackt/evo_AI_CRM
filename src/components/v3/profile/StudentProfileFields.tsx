"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  reviewPlatformStudentProfileFieldAction,
  startPlatformStudentProfileAction,
} from "@/lib/platform-student-profile-field-actions";
import type {
  PlatformReviewedProfileField,
  PlatformStudentProfileFieldActionState,
  PlatformStudentProfileFieldsSnapshot,
} from "@/lib/platform-student-profile-fields";
import {
  PROFILE_FIELDS, PROFILE_GROUPS, PROFILE_GROUP_LABELS,
  getProfileExportValues, getProfileReadiness, type ProfileFieldKey, type ProfileIssue,
} from "@/lib/student-profile-fields";
import {
  studentProfileExportIssue, studentProfileFiles,
  studentProfileFieldActionMessage, studentProfileFieldState, studentProfileProposalState,
} from "@/lib/v3/wording";
import { Icon } from "@/components/icons";
import { StatusChip } from "../blocks/StatusChip";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { StaffDisclosure } from "../settings/StaffDisclosure";
import { DocumentPreviewButton } from "./DocumentPreviewButton";
import { StudentProfileExportHistory } from "./StudentProfileExportHistory";
import type { ProfileApplication, ProfileFieldSourceVersion } from "./types";
export type ProfileFieldDraft = Readonly<{
  value: string;
  selectedSourceVersionId: string;
  selectedSourcePage: string;
  sourceValue: string | null;
  sourceState: PlatformReviewedProfileField["state"];
  sourceReviewedAt: string | null;
  sourceVersionId: string | null;
}>;
type Drafts = Partial<Record<ProfileFieldKey, ProfileFieldDraft>>;
type WorkspaceProps = Readonly<{
  snapshot: PlatformStudentProfileFieldsSnapshot;
  requestId: string;
  readOnly: boolean;
  sourceVersions: readonly ProfileFieldSourceVersion[];
  documentsHref: string | null;
  /** «Вузы и программы» — туда ведёт «Бланк университета» без заявлений; null — вкладки нет. */
  routeHref?: string | null;
  applications?: readonly Pick<ProfileApplication, "id" | "institution" | "program">[];
  /**
   * «Новый вид» (27.10.2026): классы карточки набора (`CARD_FRAME`, их передаёт `AnketaNext`) вместо прежней рамки; поля, команды и
   * состояние те же. Без свойства разметка прежняя. Классы приходят свойством, а не импортом: файл общий с прежним видом и не тянет `ui/*`.
   */
  cardClass?: string;
}>;


/** Сплошной красный — главному действию страницы; кнопки анкеты — спокойные и тёмные. */
const BUTTON = QUEUE_SECONDARY;
const PRIMARY = QUEUE_CONFIRM;
const INPUT = "min-h-11 w-full min-w-0 resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2 text-sm leading-6 text-fg focus:border-accent";
const DATE = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Bishkek" });
type ExportIssue = Pick<ProfileIssue, "key" | "kind">;
type ExportInput = Readonly<{
  snapshot: PlatformStudentProfileFieldsSnapshot; mode: "draft" | "final";
  hasDrafts: boolean; pending: boolean; savedRevision: number | null;
  saveStatus: PlatformStudentProfileFieldActionState["status"];
}>;

export function profileExportBlocker(input: ExportInput): string | null {
  if (!input.snapshot.canExport) return "unavailable_access";
  if (!input.snapshot.profile || !Number.isSafeInteger(input.snapshot.profile.revision) || input.snapshot.profile.revision < 1) return "invalid_request";
  if (input.pending) return "saving";
  if (input.hasDrafts) return "unsaved";
  if (input.saveStatus === "unavailable") return "save_unconfirmed";
  if (input.saveStatus === "stale") return "workspace_changed";
  if (input.savedRevision !== null && input.snapshot.profile.revision < input.savedRevision) return "awaiting_snapshot";
  try { getProfileExportValues(input.snapshot, input.mode); }
  catch { return "profile_not_ready"; }
  return null;
}

function ExportIssues({ issues }: Readonly<{ issues: readonly ExportIssue[] }>) {
  return <div className="space-y-3 pb-2 pt-1">
    {PROFILE_GROUPS.map(group => {
      const definitions = PROFILE_FIELDS.filter(field => field.group === group && issues.some(issue => issue.key === field.key));
      return definitions.length ? <div key={group} className="space-y-1">
        <p className="text-sm font-semibold">{PROFILE_GROUP_LABELS[group]}</p>
        <ul className="list-disc space-y-1 ps-5 text-sm leading-6 text-fg-2">
          {definitions.map(field => <li key={field.key}>{field.label}: {[...new Set(issues.filter(issue => issue.key === field.key).map(issue => studentProfileExportIssue(issue.kind)))].join("; ")}.</li>)}
        </ul>
      </div> : null;
    })}
  </div>;
}

function initialState(requestId: string): PlatformStudentProfileFieldActionState {
  return { status: "idle", requestId, studentProfileId: null, profileRevision: null };
}

export function profileFieldSummary(field: PlatformReviewedProfileField): string {
  if (field.value === null) return field.state === "confirmed" ? "Подтверждено: пусто" : "Не заполнено";
  const characters = [...field.value];
  return characters.length > 64 ? `${characters.slice(0, 64).join("")}…` : field.value;
}

export function profileFieldDraftIsStale(draft: ProfileFieldDraft | undefined, field: PlatformReviewedProfileField): boolean {
  return draft !== undefined && (draft.sourceValue !== field.value
    || draft.sourceState !== field.state || draft.sourceReviewedAt !== field.reviewedAt
    || draft.sourceVersionId !== field.sourceDocumentVersionId);
}

export function rebaseProfileFieldDraft(draft: ProfileFieldDraft, field: PlatformReviewedProfileField): ProfileFieldDraft {
  return { ...draft, sourceValue: field.value, sourceState: field.state,
    sourceReviewedAt: field.reviewedAt, sourceVersionId: field.sourceDocumentVersionId };
}

export function withoutProfileFieldDraft(drafts: Drafts, key: ProfileFieldKey): Drafts {
  const remaining = { ...drafts };
  delete remaining[key];
  return remaining;
}

export function profileFieldCommandValues(input: Readonly<{
  studentCaseId: string; fieldKey: ProfileFieldKey; revision: number; requestId: string;
  decision: "confirm" | "clear" | "reject_proposal"; proposalId?: string;
}>): Readonly<Record<string, string>> {
  return {
    student_case_id: input.studentCaseId, field_key: input.fieldKey, decision: input.decision,
    proposal_id: input.proposalId ?? "", expected_revision: String(input.revision),
    reason: "Ручная проверка поля анкеты сотрудником", request_id: input.requestId,
    ...(input.decision !== "confirm" || input.proposalId ? { value: "", source_version_id: "", source_page: "" } : {}),
  };
}

function ActionMessage({ state, pending }: { state: PlatformStudentProfileFieldActionState; pending: boolean }) {
  const message = pending ? "Сохраняем…" : studentProfileFieldActionMessage(state.status);
  return message ? <p role="status" aria-live="polite" className={`text-sm leading-6 ${state.status === "saved" ? "text-ok" : "text-fg-2"}`}>{message}</p> : null;
}

function StartProfile({ snapshot, requestId, readOnly, cardClass }: WorkspaceProps) {
  const [state, action, pending] = useActionState(async (previous: PlatformStudentProfileFieldActionState, form: FormData) => {
    try { return await startPlatformStudentProfileAction(previous, form); }
    catch { return { ...initialState(previous.requestId), status: "unavailable" as const }; }
  }, initialState(requestId));
  return <section aria-labelledby="student-profile-fields-title" className={cardClass ? `${cardClass} px-5` : "space-y-3 rounded-card border border-border bg-surface p-4"}>
    <h2 id="student-profile-fields-title" className="t-section">Анкета студента</h2>
    <p className="text-sm leading-6 text-fg-2">Анкета ещё не создана.</p>
    {snapshot.canInitialize && !readOnly ? <form action={action} className="space-y-3">
      <input type="hidden" name="student_case_id" value={snapshot.studentCaseId} />
      <input type="hidden" name="expected_profile_revision" value="0" />
      <input type="hidden" name="reason" value="Начало анкеты студента сотрудником" />
      <input type="hidden" name="request_id" value={state.requestId} />
      <button className={PRIMARY} type="submit" disabled={pending}>{pending ? "Создаём…" : "Начать анкету"}</button>
      <ActionMessage state={state} pending={pending} />
    </form> : <p className="text-sm text-fg-3">Создание анкеты в этом режиме недоступно.</p>}
  </section>;
}

function SourceDetails({ versionId, page, sourceVersions, documentsHref }: Readonly<{
  versionId: string | null; page: number | null;
  sourceVersions: readonly ProfileFieldSourceVersion[]; documentsHref: string | null;
}>) {
  if (!versionId) return <p className="text-sm text-fg-3">Версия документа не привязана.</p>;
  const source = sourceVersions.find(item => item.id === versionId);
  return <div className="space-y-2">
    <p className="break-words text-sm text-fg-2">{source ? `${source.filename} · версия ${source.versionNumber}` : "Исходная версия документа"}{page !== null ? ` · страница ${page}` : ""}</p>
    {source?.downloadReady
      ? <DocumentPreviewButton versionId={source.id} filename={source.filename} versionNumber={source.versionNumber} />
      : <p className="text-sm text-fg-3">Просмотр этой версии здесь недоступен.</p>}
    {documentsHref ? <a href={documentsHref} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">К документам дела</a> : null}
  </div>;
}

function ReviewWorkspace({ snapshot, requestId, readOnly, sourceVersions, documentsHref, routeHref = null, applications, cardClass }: WorkspaceProps) {
  const router = useRouter();
  const workspaceRef = useRef<HTMLElement>(null);
  const commandInFlight = useRef(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [exportPending, setExportPending] = useState(false);
  const [staleAtRevision, setStaleAtRevision] = useState<number | null>(null);
  const [activeField, setActiveField] = useState<ProfileFieldKey | null>(null);
  const [lastField, setLastField] = useState<ProfileFieldKey | null>(null);
  const [state, action, pending] = useActionState(async (previous: PlatformStudentProfileFieldActionState, form: FormData) => {
    const key = form.get("field_key") as ProfileFieldKey;
    const decision = form.get("decision");
    setLastField(key);
    let result: PlatformStudentProfileFieldActionState;
    try { result = await reviewPlatformStudentProfileFieldAction(previous, form); }
    catch { return { ...initialState(previous.requestId), status: "unavailable" as const }; }
    finally { commandInFlight.current = false; }
    if (result.status === "stale") {
      const attemptedRevision = Number(form.get("expected_revision"));
      setStaleAtRevision(Number.isSafeInteger(attemptedRevision) && attemptedRevision > 0 ? attemptedRevision : null);
    } else if (result.status === "saved") setStaleAtRevision(null);
    // A failed action retains every local draft. Rejecting evidence never
    // silently discards a curator's independent manual correction either.
    if (result.status === "saved" && decision !== "reject_proposal") {
      setDrafts(current => withoutProfileFieldDraft(current, key));
    }
    return result;
  }, initialState(requestId));
  useEffect(() => {
    const element = workspaceRef.current;
    const preserveDraft = (event: Event) => event.preventDefault();
    // React resets forms after settled actions, including handled errors.
    // Native interception keeps controls intact before React rerenders them.
    element?.addEventListener("reset", preserveDraft, true);
    return () => element?.removeEventListener("reset", preserveDraft, true);
  }, []);

  const profile = snapshot.profile;
  if (!profile) return null;
  const revision = profile.revision;
  const mayReview = snapshot.canReview && !readOnly;
  const readiness = getProfileReadiness(snapshot);
  const confirmedCount = snapshot.fields.filter(field => field.state === "confirmed").length;
  const byKey = new Map(snapshot.fields.map(field => [field.key, field]));
  const busy = pending || exportPending;
  const blocked = busy || !mayReview;
  const exportInput = { snapshot, hasDrafts: Object.keys(drafts).length > 0, pending: busy,
    savedRevision: state.profileRevision,
    saveStatus: state.status === "stale" && staleAtRevision !== null && revision > staleAtRevision ? "idle" as const : state.status };
  const draftBlocker = profileExportBlocker({ ...exportInput, mode: "draft" });
  const finalBlocker = profileExportBlocker({ ...exportInput, mode: "final" });

  function commandFields(field: PlatformReviewedProfileField, decision: "confirm" | "clear" | "reject_proposal", proposalId = "") {
    return Object.entries(profileFieldCommandValues({ studentCaseId: snapshot.studentCaseId,
      fieldKey: field.key, revision, requestId: state.requestId, decision, proposalId,
    })).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);
  }

  return <section ref={workspaceRef} aria-labelledby="student-profile-fields-title" className={cardClass ? "grid min-w-0 grid-cols-1 gap-4" : "min-w-0 space-y-4"}
    onSubmitCapture={event => {
      if (commandInFlight.current || blocked) { event.preventDefault(); return; }
      commandInFlight.current = true;
    }}>
    <header className={cardClass ? `${cardClass} px-5` : "space-y-2"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="student-profile-fields-title" className="t-section">Анкета студента</h2>
        <StatusChip label={readiness.ready ? "Проверена" : "Черновик"} tone={readiness.ready ? "ok" : "neutral"} />
      </div>
      <p className="text-sm leading-6 text-fg-2">Подтверждено {confirmedCount} из {PROFILE_FIELDS.length}{readiness.missingRequired.length > 0 ? ` · не заполнены обязательные: ${readiness.missingRequired.length}` : ""}</p>
      {readiness.conflicts.length > 0 ? <p className="text-sm text-danger">Источники расходятся: {readiness.conflicts.length}. Выберите верные значения.</p> : null}
      {!mayReview ? <p className="text-sm text-fg-3">Только просмотр. Изменения в этом режиме недоступны.</p> : null}
      {state.status === "stale" ? <div className="space-y-2"><ActionMessage state={state} pending={pending} /><button type="button" className={BUTTON} disabled={busy} onClick={() => router.refresh()}>Обновить анкету</button></div> : null}
    </header>

    <StudentProfileExportHistory studentCaseId={snapshot.studentCaseId} profile={profile} canExport={snapshot.canExport}
      applications={applications} routeHref={routeHref}
      frame={cardClass} ready={readiness.ready} draftBlocker={draftBlocker} finalBlocker={finalBlocker} busy={busy}
      commandInFlightRef={commandInFlight} onBusyChange={setExportPending} onRefreshProfile={() => router.refresh()}>
      {!readiness.ready ? <StaffDisclosure label={studentProfileFiles.review} buttonClassName="font-semibold">
        <ExportIssues issues={readiness.issues} />
      </StaffDisclosure> : null}
    </StudentProfileExportHistory>

    <div className={cardClass ? "divide-y divide-border rounded-card border border-border bg-card" : "divide-y divide-border rounded-card border border-border bg-surface"}>
      {PROFILE_GROUPS.map(group => {
        const definitions = PROFILE_FIELDS.filter(field => field.group === group);
        const confirmed = definitions.filter(definition => byKey.get(definition.key)?.state === "confirmed").length;
        return <StaffDisclosure key={group} label={`${PROFILE_GROUP_LABELS[group]} · ${confirmed}/${definitions.length} подтверждено`}
          className={cardClass ? "min-w-0 px-5 py-1" : "min-w-0 px-4 py-1"} buttonClassName="font-semibold [overflow-wrap:anywhere]">
          <div className="divide-y divide-border pb-3">
            {definitions.map(definition => {
              const field = byKey.get(definition.key)!;
              const draft = drafts[field.key];
              const value = draft?.value ?? field.value ?? "";
              const selectedSourceVersionId = draft?.selectedSourceVersionId ?? "";
              const selectedSourcePage = draft?.selectedSourcePage ?? "";
              const changeDraft = (change: Partial<Pick<ProfileFieldDraft, "value" | "selectedSourceVersionId" | "selectedSourcePage">>) => {
                setDrafts(current => ({ ...current, [field.key]: {
                  ...(current[field.key] ?? {
                    value: field.value ?? "", selectedSourceVersionId: "", selectedSourcePage: "",
                    sourceValue: field.value, sourceState: field.state, sourceReviewedAt: field.reviewedAt,
                    sourceVersionId: field.sourceDocumentVersionId,
                  }), ...change,
                } }));
              };
              const stale = profileFieldDraftIsStale(draft, field);
              const fieldIssues = readiness.issues.filter(issue => issue.key === field.key);
              const status = field.state === "needs_review" && field.value === null ? null : studentProfileFieldState(field.state);
              const fieldId = `profile-field-${field.key}`;
              return <div key={field.key} className="min-w-0 py-1">
                {/* Вся строка поля — переключатель: отдельная ссылка «Проверить поле» у 61 поля повторялась бы 61 раз. */}
                <button type="button" className="group flex min-h-11 w-full items-start gap-3 rounded-nav py-2 text-start"
                  aria-expanded={activeField === field.key} aria-controls={`${fieldId}-editor`}
                  onClick={() => setActiveField(current => current === field.key ? null : field.key)}>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold text-fg">{definition.label}{definition.required ? <span aria-label="обязательное поле"> *</span> : null}</span>
                      {status ? <span className={`text-sm ${field.state === "conflict" ? "text-danger" : "text-fg-3"}`}>{status}</span> : null}
                    </span>
                    <span className="mt-1 block break-words text-sm font-normal leading-6 text-fg-2">{profileFieldSummary(field)}</span>
                    {draft ? <span className="mt-1 block text-sm font-normal text-fg-3">Есть несохранённые правки.</span> : null}
                  </span>
                  <Icon name="chevron-down" size={18} className={`mt-1 shrink-0 text-fg-3 transition-transform duration-150 motion-reduce:transition-none ${activeField === field.key ? "rotate-180" : ""}`} />
                </button>
                <div id={`${fieldId}-editor`} hidden={activeField !== field.key}>
                  {activeField === field.key ? <div className="space-y-4 pb-2 pt-1">
                    {mayReview ? <>
                      <form action={action} className="space-y-3">
                        {commandFields(field, "confirm")}
                        <label htmlFor={fieldId} className="block text-sm font-medium">{definition.label}</label>
                        <textarea id={fieldId} name="value" rows={definition.maxLength > 150 ? 3 : 2} className={INPUT}
                          value={value} disabled={blocked} required maxLength={4096}
                          onChange={event => changeDraft({ value: event.currentTarget.value })} />
                        <StaffDisclosure label="Привязать оригинал — необязательно" buttonClassName="text-fg-2">
                          <div className="space-y-3 pb-2">
                            <label htmlFor={`${fieldId}-source`} className="block text-sm">Версия документа</label>
                            <select id={`${fieldId}-source`} name="source_version_id" className={INPUT} disabled={blocked}
                              value={selectedSourceVersionId} onChange={event => changeDraft({ selectedSourceVersionId: event.currentTarget.value, selectedSourcePage: "" })}>
                              <option value="">Без привязки к документу</option>
                              {sourceVersions.map(source => <option key={source.id} value={source.id}>{source.filename} · версия {source.versionNumber}</option>)}
                            </select>
                            <label htmlFor={`${fieldId}-page`} className="block text-sm">Страница, если известна</label>
                            <input id={`${fieldId}-page`} name="source_page" type="number" inputMode="numeric" min={1} max={10000}
                              className={INPUT} value={selectedSourcePage} disabled={blocked} readOnly={!selectedSourceVersionId}
                              onChange={event => changeDraft({ selectedSourcePage: event.currentTarget.value })} />
                            {selectedSourceVersionId ? <SourceDetails versionId={selectedSourceVersionId} page={selectedSourcePage ? Number(selectedSourcePage) : null}
                              sourceVersions={sourceVersions} documentsHref={documentsHref} /> : null}
                          </div>
                        </StaffDisclosure>
                        {stale ? <p className="text-sm leading-6 text-danger">Это поле изменилось после начала правок. Сверьте актуальное значение выше. Ваш текст не удалён.</p> : null}
                        {fieldIssues.map(issue => <p key={issue.kind} className="text-sm leading-6 text-fg-2">{issue.message}</p>)}
                        <div className="flex flex-wrap gap-2">
                          <button type="submit" className={PRIMARY} disabled={blocked || stale || !value.trim()}>Подтвердить значение</button>
                          {stale && draft ? <button type="button" className={BUTTON} disabled={busy}
                            onClick={() => setDrafts(current => ({ ...current, [field.key]: rebaseProfileFieldDraft(current[field.key]!, field) }))}>Сверено, оставить мои правки</button> : null}
                          {draft ? <button type="button" className={BUTTON} disabled={busy} onClick={() => setDrafts(current => withoutProfileFieldDraft(current, field.key))}>Использовать актуальное</button> : null}
                        </div>
                      </form>
                      <StaffDisclosure label="Оставить поле пустым" buttonClassName="text-fg-2">
                        <form action={action} className="space-y-3 pb-2">
                          {commandFields(field, "clear")}
                          <p className="text-sm leading-6 text-fg-2">Значение будет очищено и отмечено проверенным.</p>
                          <button type="submit" className={BUTTON} disabled={blocked || (field.state === "confirmed" && field.value === null)}>Подтвердить пустое значение</button>
                        </form>
                      </StaffDisclosure>
                    </> : <p className="whitespace-pre-wrap break-words text-sm leading-6">{field.value ?? (field.state === "confirmed" ? "Подтверждено: пусто" : "Не заполнено")}</p>}
                    {lastField === field.key ? <ActionMessage state={state} pending={pending} /> : null}
                    <StaffDisclosure label={`Источники и предложения${field.proposals.length ? ` · ${field.proposals.length}` : ""}`} buttonClassName="text-fg-2">
                      <div className="space-y-4 py-2">
                        {field.reviewedAt ? <p className="text-sm text-fg-3">Последняя проверка: <time dateTime={field.reviewedAt}>{DATE.format(new Date(field.reviewedAt))}</time>.</p> : null}
                        <SourceDetails versionId={field.sourceDocumentVersionId} page={field.sourcePage} sourceVersions={sourceVersions} documentsHref={documentsHref} />
                        {field.proposals.length === 0 ? <p className="text-sm text-fg-3">Предложений нет.</p> : <ol className="divide-y divide-border">
                          {field.proposals.map(proposal => <li key={proposal.id} className="space-y-3 py-3">
                            <p className="text-sm font-semibold">{studentProfileProposalState(proposal.status)}</p>
                            <p className="whitespace-pre-wrap break-words text-sm leading-6">{proposal.value}</p>
                            <SourceDetails versionId={proposal.sourceDocumentVersionId} page={proposal.sourcePage} sourceVersions={sourceVersions} documentsHref={documentsHref} />
                            {proposal.sourceSnippet ? <blockquote className="whitespace-pre-wrap break-words border-s-2 border-border ps-3 text-sm leading-6 text-fg-2">{proposal.sourceSnippet}</blockquote> : null}
                            {proposal.confidence !== null ? <p className="text-sm text-fg-3">Оценка уверенности: {Math.round(proposal.confidence * 100)}%.</p> : null}
                            {mayReview && proposal.status === "pending" ? <div className="flex flex-wrap gap-2">
                              <form action={action}>{commandFields(field, "confirm", proposal.id)}<button type="submit" className={BUTTON} disabled={blocked}>Принять предложение</button></form>
                              <form action={action}>{commandFields(field, "reject_proposal", proposal.id)}<button type="submit" className={BUTTON} disabled={blocked}>Отклонить предложение</button></form>
                            </div> : null}
                          </li>)}
                        </ol>}
                      </div>
                    </StaffDisclosure>
                  </div> : null}
                </div>
              </div>;
            })}
          </div>
        </StaffDisclosure>;
      })}
    </div>
  </section>;
}

export function StudentProfileFields(props: WorkspaceProps) {
  return props.snapshot.profile === null
    ? <StartProfile {...props} />
    : <ReviewWorkspace key={props.snapshot.profile.id} {...props} />;
}

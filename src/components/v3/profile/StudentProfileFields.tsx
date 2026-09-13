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
  getProfileExportValues, getProfileReadiness, isProfileFieldKey, type ProfileFieldKey, type ProfileIssue,
} from "@/lib/student-profile-fields";
import {
  studentProfileExportIssue, studentProfileExportMessage,
  studentProfileFieldActionMessage, studentProfileFieldState, studentProfileProposalState,
} from "@/lib/v3/wording";
import { StaffDisclosure } from "../settings/StaffDisclosure";
import { DocumentPreviewButton } from "./DocumentPreviewButton";
import type { ProfileFieldSourceVersion } from "./types";
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
}>;

const BUTTON = "min-h-11 rounded-ctl border border-control-edge px-3 py-2 text-sm font-semibold text-fg hover:bg-bg disabled:cursor-not-allowed";
const PRIMARY = "min-h-11 rounded-ctl border border-accent bg-accent px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed";
const INPUT = "min-h-11 w-full min-w-0 resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2 text-sm leading-6 text-fg focus:border-accent";
const DATE = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Bishkek" });
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
type ExportIssue = Pick<ProfileIssue, "key" | "kind">;
type ExportResult = Readonly<{ status: string; issues: readonly ExportIssue[] }>;
type ExportInput = Readonly<{
  snapshot: PlatformStudentProfileFieldsSnapshot; mode: "draft" | "final";
  hasDrafts: boolean; pending: boolean; savedRevision: number | null;
  saveStatus: PlatformStudentProfileFieldActionState["status"];
}>;
const EMPTY_EXPORT: ExportResult = { status: "idle", issues: [] };

export function profileExportBlocker(input: ExportInput): string | null {
  if (!input.snapshot.canExport) return "unavailable_access";
  if (!input.snapshot.profile || !Number.isSafeInteger(input.snapshot.profile.revision) || input.snapshot.profile.revision < 1) return "invalid_request";
  if (input.pending) return "saving";
  if (input.hasDrafts) return "unsaved";
  if (input.saveStatus === "unavailable") return "save_unconfirmed";
  if (input.savedRevision !== null && input.snapshot.profile.revision < input.savedRevision) return "awaiting_snapshot";
  try { getProfileExportValues(input.snapshot, input.mode); }
  catch { return "profile_not_ready"; }
  return null;
}

function safeExportIssues(value: unknown): ExportIssue[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, PROFILE_FIELDS.length * 4).flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const { key, kind } = item as Record<string, unknown>;
    if (typeof key !== "string" || !isProfileFieldKey(key) || typeof kind !== "string" || !studentProfileExportIssue(kind)) return [];
    return [{ key, kind: kind as ProfileIssue["kind"] }];
  });
}

/** Explicit-click transport only. No source values, automatic retry or persisted artifact. */
export async function requestStudentProfileExport(input: ExportInput): Promise<ExportResult> {
  const blocker = profileExportBlocker(input);
  if (blocker) return { status: blocker, issues: [] };
  try {
    const response = await fetch(`/api/v3/student-cases/${encodeURIComponent(input.snapshot.studentCaseId)}/profile-exports`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: input.mode, expected_revision: input.snapshot.profile!.revision, request_id: crypto.randomUUID() }),
    });
    if (!response.ok) {
      const body: unknown = await response.json();
      const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
      const allowed: Record<number, readonly string[]> = {
        400: ["invalid_request"], 401: ["authentication_required"], 403: ["forbidden", "access_changed"],
        409: ["profile_changed", "request_conflict", "export_request_pending", "export_request_completed"],
        422: ["profile_not_ready"], 503: ["export_unavailable", "template_unavailable", "render_failed"],
      };
      const status = typeof data.error === "string" && allowed[response.status]?.includes(data.error) ? data.error : "export_unavailable";
      return { status, issues: safeExportIssues(data.issues) };
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim() !== DOCX_MIME) throw new Error("Unexpected export response");
    const blob = await response.blob();
    if (!blob.size) throw new Error("Empty export response");
    const url = URL.createObjectURL(blob);
    let link: HTMLAnchorElement | null = null;
    try {
      link = document.createElement("a");
      link.href = url;
      link.download = input.mode === "draft" ? "EVO-Student-Profile-Draft.docx" : "EVO-Student-Profile.docx";
      document.body.appendChild(link);
      link.click();
    } finally {
      link?.remove();
      // Release on the next task, after the browser has consumed the click.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    return { status: "downloaded", issues: [] };
  } catch {
    return { status: "export_unavailable", issues: [] };
  }
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

function StartProfile({ snapshot, requestId, readOnly }: WorkspaceProps) {
  const [state, action, pending] = useActionState(async (previous: PlatformStudentProfileFieldActionState, form: FormData) => {
    try { return await startPlatformStudentProfileAction(previous, form); }
    catch { return { ...initialState(previous.requestId), status: "unavailable" as const }; }
  }, initialState(requestId));
  return <section aria-labelledby="student-profile-fields-title" className="space-y-3 rounded-card border border-border bg-surface p-4">
    <h2 id="student-profile-fields-title" className="text-base font-semibold">Анкета студента</h2>
    <p className="text-sm leading-6 text-fg-2">Анкета ещё не создана. Начните её и заполняйте сведения по мере проверки.</p>
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
    {documentsHref ? <a href={documentsHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">К документам дела</a> : null}
  </div>;
}

function ReviewWorkspace({ snapshot, requestId, readOnly, sourceVersions, documentsHref }: WorkspaceProps) {
  const router = useRouter();
  const workspaceRef = useRef<HTMLElement>(null);
  const commandInFlight = useRef(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [exportResult, setExportResult] = useState<ExportResult>(EMPTY_EXPORT);
  const [failedExportRevision, setFailedExportRevision] = useState<number | null>(null);
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
  const exportPending = exportResult.status === "pending";
  const busy = pending || exportPending;
  const blocked = busy || !mayReview;
  const exportInput = { snapshot, hasDrafts: Object.keys(drafts).length > 0, pending: busy,
    savedRevision: state.profileRevision, saveStatus: state.status };
  const needsExportRefresh = failedExportRevision === revision;
  const draftBlocker = profileExportBlocker({ ...exportInput, mode: "draft" });
  const finalBlocker = profileExportBlocker({ ...exportInput, mode: "final" });
  const exportHint = exportPending ? "pending" : draftBlocker === "profile_not_ready" ? "draft_invalid"
    : draftBlocker ?? exportResult.status;

  async function download(mode: "draft" | "final") {
    if (commandInFlight.current || needsExportRefresh || profileExportBlocker({ ...exportInput, mode })) return;
    commandInFlight.current = true;
    setExportResult({ status: "pending", issues: [] });
    try {
      const result = await requestStudentProfileExport({ ...exportInput, mode });
      setExportResult(result);
      setFailedExportRevision(result.status === "profile_changed" ? revision : null);
    } finally { commandInFlight.current = false; }
  }

  function commandFields(field: PlatformReviewedProfileField, decision: "confirm" | "clear" | "reject_proposal", proposalId = "") {
    return Object.entries(profileFieldCommandValues({ studentCaseId: snapshot.studentCaseId,
      fieldKey: field.key, revision, requestId: state.requestId, decision, proposalId,
    })).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);
  }

  return <section ref={workspaceRef} aria-labelledby="student-profile-fields-title" className="min-w-0 space-y-4"
    onSubmitCapture={event => {
      if (commandInFlight.current || blocked) { event.preventDefault(); return; }
      commandInFlight.current = true;
      setExportResult(EMPTY_EXPORT);
    }}>
    <header className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="student-profile-fields-title" className="text-base font-semibold">Анкета студента</h2>
        <span className={`text-sm font-semibold ${readiness.ready ? "text-ok" : "text-fg-2"}`}>{readiness.ready ? "Проверена" : "Черновик"}</span>
      </div>
      <p className="text-sm leading-6 text-fg-2">Подтверждено {confirmedCount} из {PROFILE_FIELDS.length} полей. Звёздочкой отмечены обязательные.</p>
      {readiness.missingRequired.length > 0 ? <p className="text-sm text-fg-2">Не заполнены обязательные поля: {readiness.missingRequired.length}.</p> : null}
      {readiness.conflicts.length > 0 ? <p className="text-sm text-danger">Источники расходятся: {readiness.conflicts.length}. Выберите верные значения.</p> : null}
      {!mayReview ? <p className="text-sm text-fg-3">Только просмотр. Изменения в этом режиме недоступны.</p> : null}
      {state.status === "stale" ? <div className="space-y-2"><ActionMessage state={state} pending={pending} /><button type="button" className={BUTTON} disabled={busy} onClick={() => router.refresh()}>Обновить анкету</button></div> : null}
    </header>

    <div className="space-y-3 border-y border-border py-4" aria-label="Скачивание анкеты">
      <p className={`text-sm font-semibold ${readiness.ready ? "text-ok" : "text-fg"}`}>
        {readiness.ready ? "Готова к финальному скачиванию" : "Финальная анкета пока не готова"}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${PRIMARY} disabled:border-border disabled:bg-bg disabled:text-fg-3 disabled:hover:brightness-100`} disabled={Boolean(finalBlocker) || needsExportRefresh}
          aria-busy={exportPending || undefined} onClick={() => void download("final")}>Скачать финальную анкету</button>
        <button type="button" className={BUTTON} disabled={Boolean(draftBlocker) || needsExportRefresh}
          aria-busy={exportPending || undefined} onClick={() => void download("draft")}>Скачать черновик</button>
      </div>
      <p className="text-sm leading-6 text-fg-2">Черновик содержит только подтверждённые поля и отметку «Черновик». Непроверенные значения в файл не попадут.</p>
      <p role="status" aria-live="polite" className="text-sm leading-6 text-fg-2">{studentProfileExportMessage(exportHint)}</p>
      {needsExportRefresh || draftBlocker === "awaiting_snapshot" || ["invalid_request", "access_changed"].includes(exportResult.status)
        ? <button type="button" className={BUTTON} disabled={busy} onClick={() => router.refresh()}>Обновить анкету для скачивания</button> : null}
      {!readiness.ready ? <StaffDisclosure label="Что проверить перед финальным скачиванием" buttonClassName="font-semibold">
        <ExportIssues issues={readiness.issues} />
      </StaffDisclosure> : null}
      {exportResult.issues.length > 0 ? <div className="space-y-1"><p className="text-sm font-semibold">Поля, которые нужно проверить</p><ExportIssues issues={exportResult.issues} /></div> : null}
    </div>

    <div className="divide-y divide-border rounded-card border border-border bg-surface">
      {PROFILE_GROUPS.map(group => {
        const definitions = PROFILE_FIELDS.filter(field => field.group === group);
        const confirmed = definitions.filter(definition => byKey.get(definition.key)?.state === "confirmed").length;
        return <StaffDisclosure key={group} label={`${PROFILE_GROUP_LABELS[group]} · ${confirmed}/${definitions.length} подтверждено`}
          className="min-w-0 px-4 py-1" buttonClassName="font-semibold [overflow-wrap:anywhere]">
          <div className="divide-y divide-border pb-3">
            {definitions.map(definition => {
              const field = byKey.get(definition.key)!;
              const draft = drafts[field.key];
              const value = draft?.value ?? field.value ?? "";
              const selectedSourceVersionId = draft?.selectedSourceVersionId ?? "";
              const selectedSourcePage = draft?.selectedSourcePage ?? "";
              const changeDraft = (change: Partial<Pick<ProfileFieldDraft, "value" | "selectedSourceVersionId" | "selectedSourcePage">>) => {
                setExportResult(EMPTY_EXPORT);
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
              return <div key={field.key} className="min-w-0 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-fg">{definition.label}{definition.required ? <span aria-label="обязательное поле"> *</span> : null}</p>
                  {status ? <span className={`text-sm ${field.state === "conflict" ? "text-danger" : "text-fg-3"}`}>{status}</span> : null}
                </div>
                <p className="mt-1 break-words text-sm leading-6 text-fg-2">{profileFieldSummary(field)}</p>
                {draft ? <p className="mt-1 text-sm text-fg-3">Есть несохранённые правки.</p> : null}
                <button type="button" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent"
                  aria-expanded={activeField === field.key} aria-controls={`${fieldId}-editor`}
                  onClick={() => setActiveField(current => current === field.key ? null : field.key)}>
                  {activeField === field.key ? "Свернуть поле" : mayReview ? "Проверить поле" : "Подробности поля"}
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
                          <p className="text-sm leading-6 text-fg-2">Это явное решение: значение будет очищено и отмечено как проверенное. Предложения не заполнят его автоматически.</p>
                          <button type="submit" className={BUTTON} disabled={blocked || (field.state === "confirmed" && field.value === null)}>Подтвердить пустое значение</button>
                        </form>
                      </StaffDisclosure>
                    </> : <p className="whitespace-pre-wrap break-words text-sm leading-6">{field.value ?? (field.state === "confirmed" ? "Подтверждено: пусто" : "Не заполнено")}</p>}
                    {lastField === field.key ? <ActionMessage state={state} pending={pending} /> : null}
                    <StaffDisclosure label={`Источники и предложения${field.proposals.length ? ` · ${field.proposals.length}` : ""}`} buttonClassName="text-fg-2">
                      <div className="space-y-4 py-2">
                        {field.reviewedAt ? <p className="text-sm text-fg-3">Последняя проверка: <time dateTime={field.reviewedAt}>{DATE.format(new Date(field.reviewedAt))}</time>.</p> : null}
                        <SourceDetails versionId={field.sourceDocumentVersionId} page={field.sourcePage} sourceVersions={sourceVersions} documentsHref={documentsHref} />
                        {field.proposals.length === 0 ? <p className="text-sm text-fg-3">Предложений нет. Значение можно проверить вручную.</p> : <ol className="divide-y divide-border">
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

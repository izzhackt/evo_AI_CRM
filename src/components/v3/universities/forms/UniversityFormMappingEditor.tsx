"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { PROFILE_FIELDS, PROFILE_GROUPS, PROFILE_GROUP_LABELS } from "@/lib/student-profile-fields";
import type { UniversityFormMapping, UniversityFormFormat, UniversityFormSourceKey } from "@/lib/university-form-fields";
import type { UniversityFormAction, UniversityFormActionState } from "@/lib/university-form-ui";
import type { UniversityTemplateManifest } from "@/lib/university-template-ingress";
import type { UniversityFormVersionMetadata } from "@/lib/university-form-registry";
import { universityTemplateSourceUrl } from "@/lib/university-template-upload-client";
import { parseUniversityTemplateSourcePreview, type UniversityTemplateSourcePreview, type UniversityTemplatePreviewSlot } from "@/lib/university-template-preview";
import { universityFormActionMessage, universityFormSourceLabel, universityFormManagement as words, universityFormWorkspace as shared } from "@/lib/v3/wording";

const control = "min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-base text-fg";
const dates = new Set(["date_of_birth", "passport_expiry_date", "desired_start_date"]);
const combined = ["full_name", "surname_first_name", "father_full_name", "mother_full_name"];

export function UniversityFormMappingEditor({ catalogId, templateId, revision, version, manifest, manifestDigest, mappingId, requestId, initialMappings, action, readOnly = false }: {
  catalogId: string; templateId: string; revision: number; version: UniversityFormVersionMetadata;
  manifest: UniversityTemplateManifest; manifestDigest: string; mappingId: string; requestId: string;
  initialMappings: readonly UniversityFormMapping[]; action: UniversityFormAction; readOnly?: boolean;
}) {
  const id = useId();
  const [mappings, setMappings] = useState<readonly UniversityFormMapping[]>(initialMappings);
  const reviewPages = [...new Set(initialMappings.map(field => Math.floor((Number(field.slotId.slice(2)) - 1) / 10) * 10))].sort((a, b) => a - b);
  const [offset, setOffset] = useState(readOnly ? reviewPages[0] ?? 0 : 0), [retry, setRetry] = useState(0);
  const [readState, setReadState] = useState<{ key: string; preview: UniversityTemplateSourcePreview | null; error: boolean } | null>(null);
  const [accessLost, setAccessLost] = useState(false), [uncertain, setUncertain] = useState(false);
  const frozen = useRef<FormData | null>(null);
  const sourceUrl = universityTemplateSourceUrl(templateId, version.id);
  const readKey = JSON.stringify([sourceUrl, version.sha256, version.byte_size, manifestDigest, offset, retry]);
  const loading = readState?.key !== readKey;
  const readError = !loading && readState?.error === true;
  const preview = !loading ? readState?.preview : null;
  useEffect(() => {
    const operation = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${sourceUrl}/preview?offset=${offset}`, { credentials: "same-origin", redirect: "error", cache: "no-store",
          signal: AbortSignal.any([operation.signal, AbortSignal.timeout(55000)]) });
        if (!response.ok) {
          if ([401, 403, 409].includes(response.status) && !operation.signal.aborted) setAccessLost(true);
          throw new Error("preview_unavailable");
        }
        if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("preview_unavailable");
        const body = await response.text();
        if (new TextEncoder().encode(body).byteLength > 131072) throw new Error("preview_unavailable");
        const result = parseUniversityTemplateSourcePreview(JSON.parse(body), { sha256: version.sha256, byteLength: version.byte_size,
          manifestDigest, offset, slots: manifest.slots });
        if (!result) throw new Error("preview_unavailable");
        if (!operation.signal.aborted) setReadState({ key: readKey, preview: result, error: false });
      } catch { if (!operation.signal.aborted) setReadState({ key: readKey, preview: null, error: true }); }
    })();
    return () => operation.abort();
  }, [sourceUrl, version.sha256, version.byte_size, manifestDigest, manifest, offset, readKey]);
  const initial: UniversityFormActionState = { status: "idle", requestId, receipt: null };
  const [state, submit, pending] = useActionState(async (previous: UniversityFormActionState, form: FormData) => {
    if (readOnly) return previous;
    const exact = frozen.current ?? form; frozen.current = exact;
    try {
      const result = await action(previous, exact);
      setUncertain(result.status === "unavailable");
      if (result.status !== "unavailable") frozen.current = null;
      return result;
    } catch (error) {
      unstable_rethrow(error); setUncertain(true);
      return { status: "unavailable" as const, requestId, receipt: null };
    }
  }, initial);
  const saved = state.status === "saved";
  const blocked = accessLost || ["forbidden", "stale_revision", "request_conflict", "source_changed", "archived", "not_inspected", "not_ready"].includes(state.status);
  const locked = readOnly || pending || uncertain || saved || blocked;
  const previousOffset = readOnly ? reviewPages.filter(page => page < offset).at(-1) : offset > 0 ? Math.max(0, offset - 10) : undefined;
  const nextOffset = readOnly ? reviewPages.find(page => page > offset) : preview?.nextOffset ?? undefined;
  const feedback = universityFormActionMessage(state.status);
  const base = `/v3/universities/${catalogId}/forms?template=${templateId}&version=${version.id}`;
  function choose(slotId: string, value: string) {
    setMappings(rows => {
      const current = rows.find(row => row.slotId === slotId);
      const rest = rows.filter(row => row.slotId !== slotId);
      if (!value) return rest;
      const manual = value === "manual";
      return [...rest, { slotId, sourceKey: manual ? null : value as UniversityFormSourceKey, manual,
        required: current?.required ?? false, format: !manual && dates.has(value) ? current?.format ?? "text" : "text" }];
    });
  }
  function update(slotId: string, patch: Partial<Pick<UniversityFormMapping, "required" | "format">>) {
    setMappings(rows => rows.map(row => row.slotId === slotId ? { ...row, ...patch } : row));
  }
  return <section aria-labelledby={`${id}-title`} className="space-y-5 border-t border-border pt-5">
    <div className="max-w-2xl space-y-2"><h3 id={`${id}-title`} className="t-section text-fg">{readOnly ? words.savedMapping : words.edit}</h3>
      <p className="text-sm leading-6 text-fg-2">{readOnly ? words.reviewExplanation : words.editExplanation}</p>
      <p className="text-sm leading-6 text-fg-2">{words.excerptExplanation}</p></div>
    <form action={readOnly ? undefined : submit} aria-busy={pending} className="space-y-5">
      {!readOnly ? Object.entries({ operation: "save_mapping", template_id: templateId, request_id: requestId, expected_revision: String(revision),
        reason: words.mappingReason, mapping_id: mappingId, template_version_id: version.id, template_sha256: version.sha256,
        mime_type: version.mime_type, mappings: JSON.stringify(mappings) }).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />) : null}
      {loading ? <p role="status" className="text-sm text-fg-2">{words.previewLoading}</p> : null}
      {readError ? <div className="space-y-2"><p role="alert" className="text-sm text-danger">{words.previewUnavailable}</p>
        {!blocked ? <button type="button" className="min-h-11 px-3 text-sm text-fg" onClick={() => setRetry(value => value + 1)}>{words.retryPreview}</button> : null}</div> : null}
      {preview ? <div className="divide-y divide-border" aria-label={words.sourceExcerpt}>
        {preview.slots.map((slot, index) => {
          const field = mappings.find(row => row.slotId === slot.id);
          if (readOnly) return field ? <UniversityFormSavedFragment key={slot.id} slot={slot} field={field} position={offset + index + 1} /> : null;
          return <div key={slot.id} className="space-y-3 py-5 first:pt-0">
            <p className="text-sm font-medium text-fg">{words.fragment} {offset + index + 1} {words.of} {preview.totalSlots}</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg">{slot.text || words.blank}</p>
            {slot.context ? <details><summary className="min-h-11 cursor-pointer py-2 text-sm text-fg-2">{words.context}</summary>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-2">{slot.context}</p></details> : null}
            {slot.truncated ? <p className="text-sm text-fg-2">{words.excerptShortened}</p> : null}
            {slot.manualReason ? <p className="text-sm leading-6 text-fg-2">{slot.manualReason}</p> : null}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-2"><label htmlFor={`${id}-${slot.id}`} className="block text-sm font-medium text-fg">{words.sourceField}</label>
                <select id={`${id}-${slot.id}`} className={control} disabled={locked} value={field?.manual ? "manual" : field?.sourceKey ?? ""} onChange={event => choose(slot.id, event.target.value)}>
                  <option value="">{words.skip}</option><option value="manual">{words.manual}</option>
                  {slot.editable ? <><optgroup label={words.combined}>{combined.map(key => <option key={key} value={key}>{universityFormSourceLabel(key)}</option>)}</optgroup>
                    {PROFILE_GROUPS.map(group => <optgroup key={group} label={PROFILE_GROUP_LABELS[group]}>
                      {PROFILE_FIELDS.filter(item => item.group === group).map(item => <option key={item.key} value={item.key}>{universityFormSourceLabel(item.key)}</option>)}
                    </optgroup>)}</> : null}
                </select></div>
              {field ? <label className="flex min-h-11 items-center gap-2 self-end text-sm text-fg"><input type="checkbox" className="h-5 w-5 accent-accent" disabled={locked}
                checked={field.required} onChange={event => update(slot.id, { required: event.target.checked })} />{words.required}</label> : null}
            </div>
            {field?.sourceKey && dates.has(field.sourceKey) ? <div className="max-w-xs space-y-2">
              <label htmlFor={`${id}-${slot.id}-format`} className="block text-sm font-medium text-fg">{words.format}</label>
              <select id={`${id}-${slot.id}-format`} className={control} disabled={locked} value={field.format} onChange={event => update(slot.id, { format: event.target.value as UniversityFormFormat })}>
                <option value="text">{words.dateFull}</option><option value="DD.MM.YYYY">31.12.2026</option><option value="DD/MM/YYYY">31/12/2026</option>
                <option value="YYYY-MM-DD">2026-12-31</option><option value="DD">{words.day}</option><option value="MM">{words.month}</option><option value="YYYY">{words.year}</option>
              </select></div> : null}
          </div>;
        })}
      </div> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={loading || previousOffset === undefined} onClick={() => previousOffset !== undefined && setOffset(previousOffset)} className="min-h-11 px-3 text-sm text-fg-2 disabled:opacity-60">{words.previous}</button>
        <button type="button" disabled={loading || nextOffset === undefined} onClick={() => nextOffset !== undefined && setOffset(nextOffset)} className="min-h-11 px-3 text-sm text-fg-2 disabled:opacity-60">{words.following}</button>
      </div>
      <p className="text-sm text-fg-2">{words.mappingCount} {mappings.length}</p>
      {feedback ? <p role="alert" className="text-sm leading-6 text-danger">{feedback}</p> : null}
      {saved ? <p role="status" className="text-sm text-fg">{words.mappingSaved}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && !saved && !blocked ? <button type="submit" disabled={pending || !mappings.length || (!uncertain && (loading || readError))}
          className="min-h-11 rounded-ctl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-60">{pending ? words.saving : uncertain ? shared.retry : words.saveMapping}</button> : null}
        {saved || blocked || uncertain ? <a href={base} className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-fg-2">{saved ? words.next : shared.reload}</a> : null}
      </div>
    </form>
  </section>;
}

/** The exact saved target and source side by side, without editable controls. */
export function UniversityFormSavedFragment({ slot, field, position }: {
  slot: UniversityTemplatePreviewSlot; field: UniversityFormMapping; position: number;
}) {
  const dateFormat: Record<string, string> = { text: words.dateFull, "DD.MM.YYYY": "31.12.2026", "DD/MM/YYYY": "31/12/2026",
    "YYYY-MM-DD": "2026-12-31", DD: words.day, MM: words.month, YYYY: words.year };
  return <div className="space-y-3 py-5 first:pt-0">
    <p className="text-sm font-medium text-fg">{words.fragment} {position}</p>
    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg">{slot.text || words.blank}</p>
    {slot.context ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-2">{slot.context}</p> : null}
    {slot.truncated ? <p className="text-sm text-fg-2">{words.excerptShortened}</p> : null}
    {slot.manualReason ? <p className="text-sm leading-6 text-fg-2">{slot.manualReason}</p> : null}
    <p className="text-sm font-medium text-fg">{words.sourceField}: {field.manual ? words.manual : universityFormSourceLabel(field.sourceKey ?? "")}
      {" · "}{field.required ? words.required : words.optional}</p>
    {field.sourceKey && dates.has(field.sourceKey) ? <p className="text-sm text-fg-2">{words.format}: {dateFormat[field.format]}</p> : null}
  </div>;
}

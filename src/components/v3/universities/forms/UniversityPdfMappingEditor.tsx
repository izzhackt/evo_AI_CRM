"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { PROFILE_FIELDS, PROFILE_GROUPS, PROFILE_GROUP_LABELS } from "@/lib/student-profile-fields";
import type { UniversityFormMapping, UniversityFormFormat, UniversityFormSourceKey, UniversityPdfPosition } from "@/lib/university-form-fields";
import type { UniversityFormAction, UniversityFormActionState } from "@/lib/university-form-ui";
import type { UniversityTemplateManifest } from "@/lib/university-template-ingress";
import type { UniversityFormVersionMetadata } from "@/lib/university-form-registry";
import type { UniversityTemplatePageMetadata } from "@/lib/university-template-page";
import { universityTemplateSourceUrl } from "@/lib/university-template-upload-client";
import { readUniversityPdfPage, universityPdfPoint, universityPdfDrag, universityPdfRegionError } from "@/lib/university-pdf-region-client";
import { universityFormActionMessage, universityFormSourceLabel, universityFormManagement as words,
  universityFormWorkspace as shared, universityPdfMapping as pdf } from "@/lib/v3/wording";

const control = "min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-base text-fg";
const button = "min-h-11 rounded-ctl px-3 py-2 text-sm font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50";
const dates = new Set(["date_of_birth", "passport_expiry_date", "desired_start_date"]);
const combined = ["full_name", "surname_first_name", "father_full_name", "mother_full_name"];

export function UniversityPdfMappingEditor({ catalogId, templateId, revision, version, manifest, manifestDigest, mappingId, requestId,
  initialMappings, action, readOnly = false }: {
  catalogId: string; templateId: string; revision: number; version: UniversityFormVersionMetadata;
  manifest: UniversityTemplateManifest; manifestDigest: string; mappingId: string; requestId: string;
  initialMappings: readonly UniversityFormMapping[]; action: UniversityFormAction; readOnly?: boolean;
}) {
  const id = useId(), frame = useRef<HTMLDivElement>(null);
  const [mappings, setMappings] = useState(initialMappings), [history, setHistory] = useState<readonly (readonly UniversityFormMapping[])[]>([]);
  const [selected, setSelected] = useState(initialMappings[0]?.slotId ?? "");
  const [page, setPage] = useState(initialMappings[0]?.position?.page ?? 1), [zoom, setZoom] = useState(100), [retry, setRetry] = useState(0);
  const [drawing, setDrawing] = useState(false), [draftRegion, setDraftRegion] = useState<UniversityPdfPosition | null>(null);
  const drag = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null), [accessLost, setAccessLost] = useState(false);
  const [readState, setReadState] = useState<{ key: string; url: string | null; metadata: UniversityTemplatePageMetadata | null; error: boolean } | null>(null);
  const [uncertain, setUncertain] = useState(false), frozen = useRef<FormData | null>(null);
  const sourceUrl = universityTemplateSourceUrl(templateId, version.id);
  const readKey = JSON.stringify([sourceUrl, version.sha256, version.byte_size, manifestDigest, page, retry]);
  const loading = readState?.key !== readKey, readError = !loading && readState?.error === true;
  const preview = !loading && !readError ? readState : null;
  useEffect(() => {
    const operation = new AbortController();
    const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(55_000)]);
    let localUrl: string | null = null;
    void (async () => {
      try {
        const response = await fetch(`${sourceUrl}/page?page=${page}`, { credentials: "same-origin", redirect: "error", cache: "no-store", signal });
        if ([401, 403, 409].includes(response.status) && !operation.signal.aborted) setAccessLost(true);
        const result = await readUniversityPdfPage(response, { sha256: version.sha256, byteLength: version.byte_size,
          manifestDigest, page, pageSizes: manifest.pageSizes }, signal);
        if (signal.aborted) return;
        localUrl = URL.createObjectURL(new Blob([result.bytes], { type: "image/png" }));
        const decoded = new Image(); decoded.src = localUrl; await decoded.decode();
        if (signal.aborted || decoded.naturalWidth !== result.metadata.pixelWidth || decoded.naturalHeight !== result.metadata.pixelHeight)
          throw new Error("page_unavailable");
        setReadState({ key: readKey, url: localUrl, metadata: result.metadata, error: false });
      } catch {
        if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = null; }
        if (!operation.signal.aborted) setReadState({ key: readKey, url: null, metadata: null, error: true });
      }
    })();
    return () => { operation.abort(); if (localUrl) URL.revokeObjectURL(localUrl); };
  }, [sourceUrl, version.sha256, version.byte_size, manifestDigest, manifest, page, readKey]);
  const initial: UniversityFormActionState = { status: "idle", requestId, receipt: null };
  const [state, submit, pending] = useActionState(async (previous: UniversityFormActionState, form: FormData) => {
    if (readOnly) return previous;
    const exact = frozen.current ?? form; frozen.current = exact;
    try {
      const result = await action(previous, exact); setUncertain(result.status === "unavailable");
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
  const field = mappings.find(item => item.slotId === selected), size = manifest.pageSizes[page - 1];
  const regionError = useMemo(() => universityPdfRegionError(mappings, manifest.pageSizes), [mappings, manifest.pageSizes]);
  const feedback = universityFormActionMessage(state.status);
  const base = `/v3/universities/${catalogId}/forms?template=${templateId}&version=${version.id}`;
  function change(next: readonly UniversityFormMapping[]) {
    if (locked) return;
    setHistory(items => [...items.slice(-29), mappings]); setMappings(next); setLocalError(null);
  }
  function update(value: Partial<UniversityFormMapping>) {
    change(mappings.map(item => item.slotId === selected ? { ...item, ...value } : item));
  }
  function add(position: UniversityPdfPosition) {
    if (locked || mappings.length >= 500) return;
    const max = Math.max(0, ...mappings.map(item => Number(item.slotId.slice(4))));
    // Reuse a free valid ID rather than ever exceeding the persisted slot bound.
    const number = max < 9999 ? max + 1 : Array.from({ length: 9999 }, (_, i) => i + 1).find(n => !mappings.some(item => item.slotId === `pdf-${n}`));
    if (!number) return;
    const slotId = `pdf-${number}`, next = [...mappings, { slotId, sourceKey: null, required: false, format: "text" as const, manual: true, position }];
    const problem = universityPdfRegionError(next, manifest.pageSizes);
    if (problem) { setLocalError(pdf[problem]); return; }
    change(next); setSelected(slotId);
  }
  function addDefault() {
    if (!size) return;
    for (let y = 12; y + 24 <= size.height; y += 30) {
      const position = { page, x: 12, y, width: Math.min(180, size.width - 24), height: 24 };
      if (!universityPdfRegionError([...mappings, { slotId: "pdf-9999", sourceKey: null, required: false, format: "text", manual: true, position }], manifest.pageSizes)) {
        add(position); return;
      }
    }
    setLocalError(pdf.noSpace);
  }
  function pointer(event: PointerEvent<HTMLDivElement>) {
    const box = frame.current?.getBoundingClientRect();
    return box && size ? universityPdfPoint(event.clientX, event.clientY, box, size) : null;
  }
  function stopDrag() { drag.current = null; setDraftRegion(null); setDrawing(false); }
  function regionStyle(position: UniversityPdfPosition) {
    return { left: `${position.x / size.width * 100}%`, top: `${position.y / size.height * 100}%`,
      width: `${position.width / size.width * 100}%`, height: `${position.height / size.height * 100}%` };
  }
  function select(slot: UniversityFormMapping) { setSelected(slot.slotId); setPage(slot.position?.page ?? page); stopDrag(); }
  return <section aria-labelledby={`${id}-title`} className="space-y-5">
    <div className="max-w-2xl space-y-2"><h3 id={`${id}-title`} className="text-lg font-bold text-fg">{readOnly ? words.savedMapping : words.edit}</h3>
      <p className="text-sm leading-6 text-fg-2">{readOnly ? words.reviewExplanation : pdf.explanation}</p></div>
    <form action={readOnly ? undefined : submit} aria-busy={pending} className="space-y-5">
      {!readOnly ? Object.entries({ operation: "save_mapping", template_id: templateId, request_id: requestId, expected_revision: String(revision),
        reason: words.mappingReason, mapping_id: mappingId, template_version_id: version.id, template_sha256: version.sha256,
        mime_type: version.mime_type, mappings: JSON.stringify(mappings) }).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40 space-y-1"><label htmlFor={`${id}-page`} className="text-sm text-fg-2">{pdf.page}</label>
          <select id={`${id}-page`} className={control} value={page} onChange={event => { setPage(Number(event.target.value)); stopDrag(); }}>
            {manifest.pageSizes.map((_, index) => <option key={index} value={index + 1}>{index + 1} {words.of} {manifest.pageSizes.length}</option>)}</select></div>
        <div className="w-32 space-y-1"><label htmlFor={`${id}-zoom`} className="text-sm text-fg-2">{pdf.zoom}</label>
          <select id={`${id}-zoom`} className={control} value={zoom} onChange={event => { setZoom(Number(event.target.value)); stopDrag(); }}>
            <option value={100}>{pdf.fit}</option><option value={150}>150%</option><option value={200}>200%</option></select></div>
        {!readOnly ? <><button type="button" className={`${button} border border-border`} disabled={locked || !preview || mappings.length >= 500}
          onClick={() => { setDrawing(!drawing); setLocalError(null); }} aria-pressed={drawing}>{drawing ? pdf.cancelDraw : pdf.draw}</button>
          <button type="button" className={button} disabled={locked || !preview || mappings.length >= 500} onClick={addDefault}>{pdf.add}</button></> : null}
      </div>
      {loading ? <p role="status" className="text-sm text-fg-2">{words.previewLoading}</p> : null}
      {readError ? <div className="space-y-2"><p role="alert" className="text-sm text-danger">{words.previewUnavailable}</p>
        {!blocked ? <button type="button" className={button} onClick={() => setRetry(value => value + 1)}>{words.retryPreview}</button> : null}</div> : null}
      {drawing ? <p role="status" className="text-sm text-fg-2">{pdf.drawHint}</p> : null}
      {preview?.url && size ? <div className="max-w-full overflow-auto bg-surface-2 p-2" tabIndex={0} aria-label={pdf.pageView}>
        <div ref={frame} className="relative select-none bg-white" style={{ width: `${zoom}%`, touchAction: drawing ? "none" : "auto", cursor: drawing ? "crosshair" : "auto" }}
          onPointerDown={event => { if (!drawing || locked || event.button !== 0) return; const point = pointer(event); if (!point) return;
            event.preventDefault(); drag.current = { ...point, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { const start = drag.current, point = pointer(event); if (start?.pointerId === event.pointerId && point) setDraftRegion(universityPdfDrag(start, point, page)); }}
          onPointerUp={event => { const start = drag.current, point = pointer(event); if (start?.pointerId !== event.pointerId || !point) return;
            const position = universityPdfDrag(start, point, page); stopDrag(); if (position) add(position); else setLocalError(pdf.bounds); }}
          onPointerCancel={stopDrag} onLostPointerCapture={() => { if (drag.current) stopDrag(); }}>
          {/* The PNG is a private verified blob, never a Next image-optimizer URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt={`${pdf.page} ${page}`} draggable={false} width={preview.metadata?.pixelWidth} height={preview.metadata?.pixelHeight} className="block h-auto w-full" />
          {mappings.map((item, index) => item.position?.page === page && [item.position.x, item.position.y, item.position.width, item.position.height].every(Number.isFinite) ? <button key={item.slotId} type="button" style={regionStyle(item.position)}
            aria-label={`${pdf.field} ${index + 1}: ${item.manual ? words.manual : universityFormSourceLabel(item.sourceKey ?? "")}`}
            aria-pressed={selected === item.slotId} onClick={() => select(item)}
            className={`absolute overflow-hidden border-2 text-left text-xs font-bold outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${selected === item.slotId ? "border-accent bg-accent/10 text-accent" : "border-fg-2 bg-surface/40 text-fg"} ${drawing ? "pointer-events-none" : ""}`}
            onKeyDown={event => {
              if (locked || selected !== item.slotId || !item.position || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault(); const step = event.shiftKey ? 10 : 1, p = item.position;
              update({ position: { ...p, x: Math.max(0, Math.min(size.width - p.width, p.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))),
                y: Math.max(0, Math.min(size.height - p.height, p.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))) } });
            }}>{index + 1}</button> : null)}
          {draftRegion ? <div className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/10" style={regionStyle(draftRegion)} /> : null}
        </div>
      </div> : null}
      {mappings.length ? <div className="space-y-4 border-t border-border pt-4">
        <div className="max-w-lg space-y-2"><label htmlFor={`${id}-field`} className="text-sm font-medium text-fg">{pdf.field}</label>
          <select id={`${id}-field`} className={control} value={selected} onChange={event => { const item = mappings.find(row => row.slotId === event.target.value); if (item) select(item); }}>
            {mappings.map((item, index) => <option key={item.slotId} value={item.slotId}>{index + 1}. {item.manual ? words.manual : universityFormSourceLabel(item.sourceKey ?? "")} · {pdf.page} {item.position?.page}</option>)}</select></div>
        {field?.position ? <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="space-y-2"><label htmlFor={`${id}-source`} className="text-sm font-medium text-fg">{words.sourceField}</label>
            <select id={`${id}-source`} className={control} disabled={locked} value={field.manual ? "manual" : field.sourceKey ?? ""}
              onChange={event => update({ manual: event.target.value === "manual", sourceKey: event.target.value === "manual" ? null : event.target.value as UniversityFormSourceKey, format: "text" })}>
              <option value="manual">{words.manual}</option><optgroup label={words.combined}>{combined.map(key => <option key={key} value={key}>{universityFormSourceLabel(key)}</option>)}</optgroup>
              {PROFILE_GROUPS.map(group => <optgroup key={group} label={PROFILE_GROUP_LABELS[group]}>{PROFILE_FIELDS.filter(item => item.group === group).map(item => <option key={item.key} value={item.key}>{universityFormSourceLabel(item.key)}</option>)}</optgroup>)}</select></div>
            <label className="flex min-h-11 items-center gap-2 self-end text-sm text-fg"><input type="checkbox" className="h-5 w-5 accent-accent" disabled={locked} checked={field.required} onChange={event => update({ required: event.target.checked })} />{words.required}</label></div>
          {field.sourceKey && dates.has(field.sourceKey) ? <div className="max-w-xs space-y-2"><label htmlFor={`${id}-format`} className="text-sm font-medium text-fg">{words.format}</label>
            <select id={`${id}-format`} className={control} disabled={locked} value={field.format} onChange={event => update({ format: event.target.value as UniversityFormFormat })}>
              <option value="text">{words.dateFull}</option><option value="DD.MM.YYYY">31.12.2026</option><option value="DD/MM/YYYY">31/12/2026</option><option value="YYYY-MM-DD">2026-12-31</option>
              <option value="DD">{words.day}</option><option value="MM">{words.month}</option><option value="YYYY">{words.year}</option></select></div> : null}
          <details><summary className={`${button} cursor-pointer`}>{pdf.precision}</summary>
            <p className="mb-3 text-sm text-fg-2">{pdf.precisionHint}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(["x", "y", "width", "height"] as const).map(key => <div key={key} className="space-y-1">
              <label htmlFor={`${id}-${key}`} className="text-sm text-fg">{pdf[key]}</label><input id={`${id}-${key}`} className={control} type="number" min={key === "x" || key === "y" ? 0 : 12} step="0.01" disabled={locked}
                value={Number.isFinite(field.position![key]) ? field.position![key] : ""} onChange={event => update({ position: { ...field.position!, [key]: event.target.valueAsNumber } })} /></div>)}</div>
            <div className="mt-3 max-w-xs space-y-1"><label htmlFor={`${id}-cells`} className="text-sm text-fg">{pdf.cellLabel}</label>
              <input id={`${id}-cells`} className={control} type="number" min="1" max="120" step="1" placeholder={pdf.noCells} disabled={locked} value={field.position.characterCount ?? ""}
                onChange={event => { const { characterCount: _previous, ...position } = field.position!; void _previous;
                  update({ position: { ...position, ...(event.target.value === "" ? {} : { characterCount: event.target.valueAsNumber }) } }); }} /></div>
          </details>
          {!readOnly ? <button type="button" className={button} disabled={locked} onClick={() => { const next = mappings.filter(item => item.slotId !== selected); change(next); setSelected(next[0]?.slotId ?? ""); }}>{pdf.remove}</button> : null}
        </div> : null}
      </div> : <p className="text-sm text-fg-2">{pdf.empty}</p>}
      {localError || regionError ? <p role="alert" className="text-sm text-danger">{localError ?? pdf[regionError!]}</p> : null}
      {feedback ? <p role="alert" className="text-sm text-danger">{feedback}</p> : null}
      {saved ? <p role="status" className="text-sm text-fg">{words.mappingSaved}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && !saved && !blocked ? <button type="submit" disabled={pending || !mappings.length || (!uncertain && (loading || readError || !!regionError || drawing))}
          className="min-h-11 rounded-ctl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">{pending ? words.saving : uncertain ? shared.retry : words.saveMapping}</button> : null}
        {!readOnly ? <><button type="button" className={button} disabled={locked || !history.length} onClick={() => { const previous = history.at(-1)!; setMappings(previous); setHistory(history.slice(0, -1)); setSelected(previous[0]?.slotId ?? ""); setLocalError(null); }}>{pdf.undo}</button>
          <button type="button" className={button} disabled={locked || !history.length} onClick={() => { change(initialMappings); setSelected(initialMappings[0]?.slotId ?? ""); }}>{pdf.reset}</button></> : null}
        {saved || blocked || uncertain ? <a href={base} className={button}>{saved ? words.next : shared.reload}</a> : null}
      </div>
    </form>
  </section>;
}

"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { btnGhostCls, inputCls, fieldLabelCls } from "@/components/ui";
import {
  searchApplicationUniversitiesAction,
  type ApplicationUniversitySearchResult,
} from "@/lib/platform-admissions-actions";
import { applicationUniversitySelector as words, country } from "@/lib/v3/wording";

export function ApplicationUniversitySelector() {
  const [manual, setManual] = useState(false);
  const [manualName, setManualName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [result, setResult] = useState<ApplicationUniversitySearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current += 1; }, []);

  function invalidate() {
    epoch.current += 1;
    setLoading(false);
    setResult(null);
    setSelectedId("");
    setOffset(0);
  }

  function search(nextOffset = 0) {
    const request = ++epoch.current;
    setLoading(true);
    setResult(null);
    setSelectedId("");
    setOffset(nextOffset);
    startTransition(async () => {
      let next: ApplicationUniversitySearchResult;
      try {
        next = await searchApplicationUniversitiesAction({ query, offset: nextOffset });
      } catch {
        next = { status: "unavailable", items: [], nextOffset: null };
      }
      if (request !== epoch.current) return;
      setResult(next);
      setLoading(false);
    });
  }

  return (
    <div className="space-y-3 md:col-span-2" data-testid="v3-application-university-selector" aria-busy={loading}>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={manual} onChange={(event) => {
          invalidate();
          setManual(event.target.checked);
        }} />
        {words.manual}
      </label>
      {manual ? <>
        <input type="hidden" name="catalog_institution_id" value="" />
        <label className="block">
          <span className={fieldLabelCls}>{words.institution}</span>
          <input name="institution_name" required maxLength={300} value={manualName}
            onChange={(event) => setManualName(event.target.value)} className={inputCls} />
        </label>
        <p className="text-xs text-muted-foreground">{words.manualHint}</p>
      </> : <>
        <input type="hidden" name="institution_name" value="" />
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className={fieldLabelCls}>{words.searchLabel}</span>
            <input value={query} maxLength={100} className={inputCls}
              onChange={(event) => { invalidate(); setQuery(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (!event.nativeEvent.isComposing && !loading) search();
              }} />
          </label>
          <button type="button" className={btnGhostCls} disabled={loading}
            onClick={() => search()}>{words.search}</button>
        </div>
        <label className="block">
          <span className={fieldLabelCls}>{words.selectLabel}</span>
          <select name="catalog_institution_id" required value={selectedId}
            className={inputCls} onChange={(event) => setSelectedId(event.target.value)}>
            <option value="">{words.placeholder}</option>
            {result?.status === "ready" && result.items.map((item) => {
              const countryLabel = country(item.country);
              return <option key={item.id} value={item.id}>{item.name}{countryLabel ? ` · ${countryLabel}` : ""}</option>;
            })}
          </select>
        </label>
        <div aria-live="polite" className="text-xs text-muted-foreground">
          {loading ? words.loading : result === null ? words.hint :
            result.status === "ready" ? (result.items.length === 0 ? words.empty : null) :
              words.errors[result.status]}
        </div>
        {result && result.status !== "ready" && <button type="button" className={btnGhostCls}
          onClick={() => search(offset)}>{words.retry}</button>}
        {result?.status === "ready" && (offset > 0 || result.nextOffset !== null) &&
          <div className="flex gap-2">
            <button type="button" className={btnGhostCls} disabled={offset === 0}
              onClick={() => search(Math.max(0, offset - 30))}>{words.previous}</button>
            <button type="button" className={btnGhostCls} disabled={result.nextOffset === null}
              onClick={() => { if (result.nextOffset !== null) search(result.nextOffset); }}>{words.next}</button>
          </div>}
      </>}
    </div>
  );
}

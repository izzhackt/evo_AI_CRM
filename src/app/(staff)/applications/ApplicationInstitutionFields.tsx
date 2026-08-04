"use client";

import { useId, useState } from "react";

import { inputCls, labelCls } from "@/components/ui";

export type ApplicationInstitutionOption = Readonly<{
  id: string;
  label: string;
}>;

export function ApplicationInstitutionFields({
  catalogInstitutions,
  catalogLabel,
  catalogManualOption,
  manualInstitutionLabel,
  catalogHint,
}: Readonly<{
  catalogInstitutions: readonly ApplicationInstitutionOption[];
  catalogLabel: string;
  catalogManualOption: string;
  manualInstitutionLabel: string;
  catalogHint?: string;
}>) {
  const [catalogInstitutionId, setCatalogInstitutionId] = useState("");
  const catalogHintId = useId();
  const usesManualInstitution = catalogInstitutionId === "";

  return (
    <>
      <label className={labelCls}>
        {catalogLabel}
        <select
          name="catalog_institution_id"
          value={catalogInstitutionId}
          onChange={(event) => setCatalogInstitutionId(event.target.value)}
          aria-describedby={catalogHint ? catalogHintId : undefined}
          className={`${inputCls} mt-1`}
        >
          <option value="">{catalogManualOption}</option>
          {catalogInstitutions.map((institution) => (
            <option key={institution.id} value={institution.id}>
              {institution.label}
            </option>
          ))}
        </select>
        {catalogHint ? (
          <span
            id={catalogHintId}
            className="mt-1 block text-[11px] font-normal text-fg-3"
          >
            {catalogHint}
          </span>
        ) : null}
      </label>
      <label className={labelCls}>
        {manualInstitutionLabel}
        <input
          name="institution_name"
          required={usesManualInstitution}
          disabled={!usesManualInstitution}
          aria-required={usesManualInstitution}
          maxLength={300}
          className={`${inputCls} mt-1 disabled:cursor-not-allowed disabled:opacity-60`}
        />
      </label>
    </>
  );
}
